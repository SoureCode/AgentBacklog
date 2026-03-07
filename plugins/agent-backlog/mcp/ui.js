#!/usr/bin/env node
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  openDatabase, closeDatabase, prepareStatements, loadRegistry,
  now, requireItem, fullItem, allSummaries, deleteChecklistRecursive, bumpVersion,
  VersionConflictError, tryBecomeUILeader, releaseUILeadership,
} from "./db.js";
import {
  validate,
  PatchItemBodySchema, AddChecklistBodySchema, PatchChecklistBodySchema, AddCommentSchema,
} from "./schemas.js";
import { logger } from "./logger.js";
import { parseBody, parsePositiveInt, json } from "./http-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KANBAN_HTML = readFileSync(join(__dirname, "kanban.html"), "utf8");

// ── remote mode detection ─────────────────────────────────────────────────

const REMOTE_API_URL = process.env.BACKLOG_API_URL;
const REMOTE_API_KEY = process.env.BACKLOG_API_KEY;
const isRemoteMode = !!(REMOTE_API_URL && REMOTE_API_KEY);

// ── remote mode helpers ───────────────────────────────────────────────────

async function remoteListProjects() {
  const res = await fetch(`${REMOTE_API_URL}/api/projects`);
  return res.json();
}

async function remoteProxyRequest(path, req, res) {
  const url = `${REMOTE_API_URL}/api/projects${path}`;
  const headers = { "Content-Type": "application/json" };
  // Admin endpoints on the API server don't need auth for project listing,
  // but per-project endpoints may need it
  if (REMOTE_API_KEY) {
    headers.Authorization = `Bearer ${REMOTE_API_KEY}`;
  }

  const options = { method: req.method, headers };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => resolve(data));
    });
    if (body) options.body = body;
  }

  const upstream = await fetch(url, options);
  const contentType = upstream.headers.get("content-type") || "application/json";

  // For SSE, pipe the upstream response
  if (contentType.includes("text/event-stream")) {
    res.writeHead(upstream.status, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    // Stream the response body
    const reader = upstream.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        res.write(value);
      }
    };
    pump().catch(() => res.end());
    req.on("close", () => { reader.cancel(); });
    return;
  }

  const data = await upstream.text();
  res.writeHead(upstream.status, { "Content-Type": contentType });
  res.end(data);
}

// ── local mode: project database pool ─────────────────────────────────────

const dbPool = new Map();

function getProject(slug) {
  if (dbPool.has(slug)) return dbPool.get(slug);

  const registry = loadRegistry();
  const project = registry.projects[slug];
  if (!project) return null;
  if (!existsSync(project.db)) return null;

  const db = openDatabase(project.db);
  const stmts = prepareStatements(db);
  const entry = { db, stmts, ...project };
  dbPool.set(slug, entry);
  return entry;
}

function listProjects() {
  const registry = loadRegistry();
  const projects = [];
  for (const [slug, project] of Object.entries(registry.projects)) {
    if (!existsSync(project.db)) continue;
    try {
      const p = getProject(slug);
      if (p) {
        const counts = p.stmts.countItemsByStatus.all();
        const byStatus = Object.fromEntries(counts.map((r) => [r.status, r.cnt]));
        const open = byStatus.open ?? 0;
        const inProgress = byStatus.in_progress ?? 0;
        const done = byStatus.done ?? 0;
        const total = open + inProgress + done;
        projects.push({ slug, root: project.root, open, in_progress: inProgress, done, total });
      }
    } catch {
      projects.push({ slug, root: project.root, error: true });
    }
  }
  return projects;
}

// ── SSE clients per project (local mode only) ─────────────────────────────

const sseClients = new Map();
const lastBroadcast = new Map();

function broadcastProject(slug, onlyIfChanged = false) {
  const clients = sseClients.get(slug);
  if (!clients || clients.size === 0) return;
  const project = getProject(slug);
  if (!project) return;
  const data = allSummaries(project.stmts);
  const msg = `event: update\ndata: ${JSON.stringify(data)}\n\n`;
  if (onlyIfChanged && lastBroadcast.get(slug) === msg) return;
  lastBroadcast.set(slug, msg);
  for (const res of clients) {
    if (res.writableEnded) { clients.delete(res); continue; }
    try { res.write(msg); } catch (e) { logger.warn("ui:sse-write-error", { slug, error: e.message }); clients.delete(res); }
  }
}

// ── HTTP request handler ──────────────────────────────────────────────────

async function handleRequest(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost`);

  try {
    // Serve kanban HTML
    if (req.method === "GET" && (url.pathname === "/" || url.pathname.match(/^\/project\/.+$/))) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(KANBAN_HTML);
      return;
    }

    // ── Remote mode: proxy to API server ────────────────────────────────

    if (isRemoteMode) {
      if (req.method === "GET" && url.pathname === "/api/projects") {
        const projects = await remoteListProjects();
        json(res, 200, projects);
        return;
      }

      // Proxy project-scoped routes
      const projectMatch = url.pathname.match(/^\/api\/projects\/(.+)$/);
      if (projectMatch) {
        await remoteProxyRequest("/" + projectMatch[1], req, res);
        return;
      }

      json(res, 404, { error: "Not found" });
      return;
    }

    // ── Local mode: direct DB access ────────────────────────────────────

    // List projects
    if (req.method === "GET" && url.pathname === "/api/projects") {
      json(res, 200, listProjects());
      return;
    }

    // Project-scoped API routes: /api/projects/:slug/...
    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/(.+)$/);
    if (!projectMatch) {
      json(res, 404, { error: "Not found" });
      return;
    }

    const slug = decodeURIComponent(projectMatch[1]);
    const path = "/" + projectMatch[2];
    const project = getProject(slug);

    if (!project) {
      json(res, 404, { error: `Project "${slug}" not found or database missing` });
      return;
    }

    const { stmts } = project;

    // SSE
    if (req.method === "GET" && path === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: update\ndata: ${JSON.stringify(allSummaries(stmts))}\n\n`);
      if (!sseClients.has(slug)) sseClients.set(slug, new Set());
      sseClients.get(slug).add(res);
      req.on("close", () => { sseClients.get(slug)?.delete(res); });
      return;
    }

    // List items
    if (req.method === "GET" && path === "/items") {
      json(res, 200, allSummaries(stmts));
      return;
    }

    // Single item routes
    const itemMatch = path.match(/^\/items\/(\d+)$/);
    if (itemMatch) {
      const id = parsePositiveInt(itemMatch[1]);

      if (req.method === "GET") {
        json(res, 200, fullItem(stmts, id));
        return;
      }

      if (req.method === "PATCH") {
        const body = await parseBody(req);
        const fields = validate(PatchItemBodySchema, body);
        const item = requireItem(stmts, id);
        const versionHeader = req.headers["if-match"];
        const expectedVersion = versionHeader ? parseInt(versionHeader, 10) : fields.version;
        if (expectedVersion !== undefined && expectedVersion !== item.version) {
          res.writeHead(409, { "Content-Type": "application/json", ETag: String(item.version) });
          res.end(JSON.stringify({ error: "Version conflict", current: fullItem(stmts, id) }));
          return;
        }
        const result = stmts.updateItem.run(
          fields.title ?? item.title,
          fields.description ?? item.description,
          fields.status ?? item.status,
          now(),
          id,
          item.version
        );
        if (result.changes === 0) {
          const current = fullItem(stmts, id);
          res.writeHead(409, { "Content-Type": "application/json", ETag: String(current.version) });
          res.end(JSON.stringify({ error: "Version conflict", current }));
          return;
        }
        const updated = fullItem(stmts, id);
        broadcastProject(slug);
        res.writeHead(200, { "Content-Type": "application/json", ETag: String(updated.version) });
        res.end(JSON.stringify(updated));
        return;
      }

      if (req.method === "DELETE") {
        requireItem(stmts, id);
        stmts.deleteItem.run(id);
        broadcastProject(slug);
        json(res, 200, { deleted: id });
        return;
      }
    }

    // Checklist routes
    const clMatch = path.match(/^\/items\/(\d+)\/checklist(?:\/(\d+))?$/);
    if (clMatch) {
      const itemId = parsePositiveInt(clMatch[1], "item_id");
      const cid = clMatch[2] ? parsePositiveInt(clMatch[2], "cid") : null;

      if (req.method === "POST" && cid === null) {
        const body = await parseBody(req);
        const { label, parent_id } = validate(AddChecklistBodySchema, body);
        const item = requireItem(stmts, itemId);
        if (parent_id != null) {
          const parent = stmts.getChecklistItem.get(parent_id, itemId);
          if (!parent) { json(res, 404, { error: "parent not found" }); return; }
        }
        const position = parent_id != null
          ? stmts.countChecklistByParent.get(itemId, parent_id).cnt
          : stmts.countTopChecklist.get(itemId).cnt;
        const result = stmts.addChecklist.run(itemId, parent_id ?? null, label.trim(), position);
        bumpVersion(stmts, itemId, item.version);
        broadcastProject(slug);
        json(res, 201, { id: Number(result.lastInsertRowid), label: label.trim(), checked: false, position, children: [] });
        return;
      }

      if (req.method === "PATCH" && cid !== null) {
        const body = await parseBody(req);
        const fields = validate(PatchChecklistBodySchema, body);
        const item = requireItem(stmts, itemId);
        const entry = stmts.getChecklistItem.get(cid, itemId);
        if (!entry) { json(res, 404, { error: "checklist item not found" }); return; }
        stmts.updateChecklist.run(
          fields.label ?? entry.label,
          fields.checked !== undefined ? (fields.checked ? 1 : 0) : entry.checked,
          cid
        );
        bumpVersion(stmts, itemId, item.version);
        const updated = stmts.getChecklistItem.get(cid, itemId);
        broadcastProject(slug);
        json(res, 200, { ...updated, checked: !!updated.checked });
        return;
      }

      if (req.method === "DELETE" && cid !== null) {
        const item = requireItem(stmts, itemId);
        const entry = stmts.getChecklistItem.get(cid, itemId);
        if (!entry) { json(res, 404, { error: "checklist item not found" }); return; }
        deleteChecklistRecursive(stmts, cid);
        bumpVersion(stmts, itemId, item.version);
        broadcastProject(slug);
        json(res, 200, { deleted: cid });
        return;
      }
    }

    // Add human comment
    const commentMatch = path.match(/^\/items\/(\d+)\/comments$/);
    if (commentMatch && req.method === "POST") {
      const id = parsePositiveInt(commentMatch[1], "item_id");
      const body = await parseBody(req);
      const { body: commentBody } = validate(AddCommentSchema, body);
      const item = requireItem(stmts, id);
      const ts = now();
      const result = stmts.addComment.run(id, "human", commentBody.trim(), ts);
      bumpVersion(stmts, id, item.version);
      broadcastProject(slug);
      json(res, 201, { id: Number(result.lastInsertRowid), author: "human", body: commentBody.trim(), created_at: ts });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    if (e instanceof VersionConflictError) {
      json(res, 409, { error: e.message, current: e.currentItem });
      return;
    }
    const code = e.message.includes("not found") ? 404 : 400;
    logger.error("ui:request-error", { method: req.method, path: url.pathname, status: code, error: e.message });
    json(res, code, { error: e.message });
  }
}

// ── exported startUI function ─────────────────────────────────────────────

let pollInterval = null;
let httpServer = null;

export function startUI(port) {
  httpServer = createServer(handleRequest);

  // Poll for DB changes from MCP servers (local mode only)
  if (!isRemoteMode) {
    pollInterval = setInterval(() => {
      for (const slug of sseClients.keys()) {
        if (sseClients.get(slug).size > 0) {
          broadcastProject(slug, true);
        }
      }
    }, 2000);
  }

  return new Promise((resolve) => {
    httpServer.listen(port, "0.0.0.0", () => {
      resolve(httpServer);
    });
  });
}

export function stopUI() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  // Close all active SSE connections so httpServer.close() can finish
  for (const [, clients] of sseClients) {
    for (const res of clients) {
      try { res.end(); } catch { /* ignore */ }
    }
  }
  sseClients.clear();
  for (const { db } of dbPool.values()) {
    try { closeDatabase(db); } catch { /* ignore */ }
  }
  dbPool.clear();
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
}

// ── standalone mode ───────────────────────────────────────────────────────

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = parseInt(process.env.BACKLOG_UI_PORT ?? "3456", 10);
  const { isLeader } = tryBecomeUILeader(port);
  if (!isLeader) {
    console.log(`UI already running (see lock file). Use a different port or stop the other instance.`);
    process.exit(1);
  }

  await startUI(port);
  console.log(`Backlog UI: http://localhost:${port}`);
  if (isRemoteMode) {
    console.log(`Remote mode: proxying to ${REMOTE_API_URL}`);
  }

  function shutdown() {
    releaseUILeadership();
    stopUI();
    // stopUI() called httpServer.close() — give it a moment then exit
    setTimeout(() => process.exit(0), 1000).unref();
    process.exitCode = 0;
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
