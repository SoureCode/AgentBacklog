#!/usr/bin/env node
import { createServer } from "http";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { LocalStore } from "./store-local.js";
import { VersionConflictError } from "./db.js";
import {
  now, requireItem, fullItem, allSummaries, deleteChecklistRecursive,
} from "./db.js";
import {
  validate,
  CreateItemSchema, UpdateItemSchema,
  AddChecklistSchema, UpdateChecklistSchema, DeleteChecklistSchema,
  AddCommentSchema,
  AddDependencySchema, RemoveDependencySchema,
} from "./schemas.js";
import { logger } from "./logger.js";

// ── config ────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 4000;
const CONFIG_DIR = process.env.BACKLOG_API_DATA_DIR
  ?? join(homedir(), ".config", "agent-backlog-server");
const DATA_DIR = join(CONFIG_DIR, "data");
const API_KEYS_PATH = join(CONFIG_DIR, "api-keys.json");

// ── API key management ────────────────────────────────────────────────────

function loadApiKeys() {
  if (!existsSync(API_KEYS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(API_KEYS_PATH, "utf8"));
  } catch (e) {
    logger.warn("api-keys:parse-error", { error: e.message });
    return {};
  }
}

function saveApiKeys(keys) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(API_KEYS_PATH, JSON.stringify(keys, null, 2) + "\n", "utf8");
}

function generateApiKey() {
  return "sk-proj-" + randomBytes(24).toString("hex");
}

// ── store pool ────────────────────────────────────────────────────────────

const storePool = new Map();

function getStoreForSlug(slug) {
  if (storePool.has(slug)) return storePool.get(slug);
  const dbPath = join(DATA_DIR, `${slug}.backlog.db`);
  const store = new LocalStore(dbPath);
  storePool.set(slug, store);
  return store;
}

// ── SSE clients per project ───────────────────────────────────────────────

const sseClients = new Map();

function broadcastProject(slug) {
  const clients = sseClients.get(slug);
  if (!clients || clients.size === 0) return;
  const store = getStoreForSlug(slug);
  const data = store.listItems();
  const msg = `event: update\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    if (res.writableEnded) { clients.delete(res); continue; }
    try { res.write(msg); } catch (e) { logger.warn("api:sse-write-error", { slug, error: e.message }); clients.delete(res); }
  }
}

// ── auth middleware ───────────────────────────────────────────────────────

function authenticate(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const key = auth.slice(7);
  const keys = loadApiKeys();
  const entry = keys[key];
  if (!entry) return null;
  return entry.slug;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 1_048_576; // 1 MB

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large (max 1 MB)"));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!body) { resolve({}); return; }
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function parsePositiveInt(str, name = "id") {
  const n = parseInt(str, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid ${name}: must be a positive integer`);
  return n;
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ── HTTP request handler ──────────────────────────────────────────────────

async function handleRequest(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost`);

  try {
    // Health check — no auth required
    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, { status: "ok" });
      return;
    }

    // ── Admin / UI-facing endpoints (localhost-only) ────────────────────

    // List all projects with item counts
    if (req.method === "GET" && url.pathname === "/api/projects") {
      const keys = loadApiKeys();
      const slugs = new Set(Object.values(keys).map((k) => k.slug));
      const projects = [];
      for (const slug of slugs) {
        try {
          const store = getStoreForSlug(slug);
          const items = store.listItems();
          const open = items.filter((i) => i.status === "open").length;
          const inProgress = items.filter((i) => i.status === "in_progress").length;
          const done = items.filter((i) => i.status === "done").length;
          projects.push({ slug, open, in_progress: inProgress, done, total: items.length });
        } catch (e) {
          logger.error("api:project-list-error", { slug, error: e.message });
          projects.push({ slug, error: true });
        }
      }
      json(res, 200, projects);
      return;
    }

    // Project-scoped admin routes: /api/projects/:slug/...
    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/(.+)$/);
    if (projectMatch) {
      const projectSlug = decodeURIComponent(projectMatch[1]);
      const path = "/" + projectMatch[2];
      const keys = loadApiKeys();
      const slugs = new Set(Object.values(keys).map((k) => k.slug));
      if (!slugs.has(projectSlug)) {
        json(res, 404, { error: `Project "${projectSlug}" not found` });
        return;
      }
      const store = getStoreForSlug(projectSlug);

      // SSE for project
      if (req.method === "GET" && path === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`event: update\ndata: ${JSON.stringify(store.listItems())}\n\n`);
        if (!sseClients.has(projectSlug)) sseClients.set(projectSlug, new Set());
        sseClients.get(projectSlug).add(res);
        req.on("close", () => { sseClients.get(projectSlug)?.delete(res); });
        return;
      }

      // Items list for project
      if (req.method === "GET" && path === "/items") {
        json(res, 200, store.listItems());
        return;
      }

      json(res, 404, { error: "Not found" });
      return;
    }

    // ── Authenticated API endpoints ────────────────────────────────────

    const projectSlug = authenticate(req);
    if (!projectSlug) {
      json(res, 401, { error: "Unauthorized — provide Authorization: Bearer <key>" });
      return;
    }

    const store = getStoreForSlug(projectSlug);

    // GET /api/items
    if (req.method === "GET" && url.pathname === "/api/items") {
      const status = url.searchParams.get("status") || undefined;
      json(res, 200, store.listItems(status));
      return;
    }

    // POST /api/items
    if (req.method === "POST" && url.pathname === "/api/items") {
      const body = await parseBody(req);
      const data = validate(CreateItemSchema, body);
      const item = store.createItem(data);
      broadcastProject(projectSlug);
      json(res, 201, item);
      return;
    }

    // GET /api/items/:id
    const itemMatch = url.pathname.match(/^\/api\/items\/(\d+)$/);
    if (itemMatch) {
      const id = parsePositiveInt(itemMatch[1]);

      if (req.method === "GET") {
        json(res, 200, store.getItem(id));
        return;
      }

      if (req.method === "PATCH") {
        const body = await parseBody(req);
        const data = validate(UpdateItemSchema, body);
        const result = store.updateItem(id, data);
        broadcastProject(projectSlug);
        json(res, 200, result);
        return;
      }
    }

    // GET /api/search
    if (req.method === "GET" && url.pathname === "/api/search") {
      const q = url.searchParams.get("q");
      if (!q) { json(res, 400, { error: "q parameter required" }); return; }
      const status = url.searchParams.get("status") || undefined;
      json(res, 200, store.searchItems(q, status));
      return;
    }

    // POST /api/items/:id/checklist
    const clAddMatch = url.pathname.match(/^\/api\/items\/(\d+)\/checklist$/);
    if (clAddMatch && req.method === "POST") {
      const item_id = parsePositiveInt(clAddMatch[1], "item_id");
      const body = await parseBody(req);
      const data = validate(AddChecklistSchema, body);
      const result = store.addChecklist(item_id, data);
      broadcastProject(projectSlug);
      json(res, 201, result);
      return;
    }

    // PATCH /api/items/:id/checklist/:cid
    const clUpdateMatch = url.pathname.match(/^\/api\/items\/(\d+)\/checklist\/(\d+)$/);
    if (clUpdateMatch && req.method === "PATCH") {
      const item_id = parsePositiveInt(clUpdateMatch[1], "item_id");
      const cid = parsePositiveInt(clUpdateMatch[2], "cid");
      const body = await parseBody(req);
      const data = validate(UpdateChecklistSchema, body);
      data.id = cid;
      const result = store.updateChecklist(item_id, data);
      broadcastProject(projectSlug);
      json(res, 200, result);
      return;
    }

    // DELETE /api/items/:id/checklist/:cid
    if (clUpdateMatch && req.method === "DELETE") {
      const item_id = parsePositiveInt(clUpdateMatch[1], "item_id");
      const cid = parsePositiveInt(clUpdateMatch[2], "cid");
      const body = await parseBody(req);
      const data = validate(DeleteChecklistSchema, body);
      data.id = cid;
      const result = store.deleteChecklist(item_id, data);
      broadcastProject(projectSlug);
      json(res, 200, result);
      return;
    }

    // POST /api/items/:id/comments
    const commentMatch = url.pathname.match(/^\/api\/items\/(\d+)\/comments$/);
    if (commentMatch && req.method === "POST") {
      const item_id = parsePositiveInt(commentMatch[1], "item_id");
      const body = await parseBody(req);
      const data = validate(AddCommentSchema, body);
      const result = store.addComment(item_id, data);
      broadcastProject(projectSlug);
      json(res, 201, result);
      return;
    }

    // POST /api/items/:id/dependencies
    const depAddMatch = url.pathname.match(/^\/api\/items\/(\d+)\/dependencies$/);
    if (depAddMatch && req.method === "POST") {
      const item_id = parsePositiveInt(depAddMatch[1], "item_id");
      const body = await parseBody(req);
      const data = validate(AddDependencySchema, body);
      const result = store.addDependency(item_id, data);
      broadcastProject(projectSlug);
      json(res, 201, result);
      return;
    }

    // DELETE /api/items/:id/dependencies/:did
    const depDelMatch = url.pathname.match(/^\/api\/items\/(\d+)\/dependencies\/(\d+)$/);
    if (depDelMatch && req.method === "DELETE") {
      const item_id = parsePositiveInt(depDelMatch[1], "item_id");
      const depends_on_id = parsePositiveInt(depDelMatch[2], "depends_on_id");
      const body = await parseBody(req);
      const data = validate(RemoveDependencySchema, body);
      const result = store.removeDependency(item_id, { ...data, depends_on_id });
      broadcastProject(projectSlug);
      json(res, 200, result);
      return;
    }

    // SSE for authenticated project
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: update\ndata: ${JSON.stringify(store.listItems())}\n\n`);
      if (!sseClients.has(projectSlug)) sseClients.set(projectSlug, new Set());
      sseClients.get(projectSlug).add(res);
      req.on("close", () => { sseClients.get(projectSlug)?.delete(res); });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    if (e instanceof VersionConflictError) {
      logger.warn("api:version-conflict", {
        path: url.pathname,
        id: e.currentItem?.id,
        currentVersion: e.currentItem?.version,
        yourVersion: e.message.match(/your version: (\d+)/)?.[1],
      });
      json(res, 409, { error: e.message, current: e.currentItem, id: 0, expectedVersion: 0 });
      return;
    }
    const code = e.message.includes("not found") ? 404 : 400;
    logger.error("api:request-error", { method: req.method, path: url.pathname, status: code, error: e.message });
    json(res, code, { error: e.message });
  }
}

// ── CLI commands ──────────────────────────────────────────────────────────

const [,, command, ...args] = process.argv;

if (command === "create-project") {
  const slug = args[0];
  if (!slug) {
    console.error("Usage: agent-backlog-api create-project <slug>");
    process.exit(1);
  }
  mkdirSync(DATA_DIR, { recursive: true });
  const keys = loadApiKeys();
  // Check if slug already exists
  for (const [key, entry] of Object.entries(keys)) {
    if (entry.slug === slug) {
      console.log(`Project "${slug}" already exists.`);
      console.log(`API Key: ${key}`);
      process.exit(0);
    }
  }
  const apiKey = generateApiKey();
  keys[apiKey] = { slug, created: new Date().toISOString() };
  saveApiKeys(keys);
  // Initialize the database by opening it
  const store = getStoreForSlug(slug);
  store.close();
  storePool.delete(slug);
  console.log(`Project "${slug}" created.`);
  console.log(`API Key: ${apiKey}`);
  console.log(`DB: ${join(DATA_DIR, `${slug}.backlog.db`)}`);

} else if (command === "list-projects") {
  const keys = loadApiKeys();
  const slugs = new Map();
  for (const [key, entry] of Object.entries(keys)) {
    if (!slugs.has(entry.slug)) {
      slugs.set(entry.slug, { keys: [], created: entry.created });
    }
    slugs.get(entry.slug).keys.push(key);
  }
  if (slugs.size === 0) {
    console.log("No projects.");
  } else {
    for (const [slug, info] of slugs) {
      const dbPath = join(DATA_DIR, `${slug}.backlog.db`);
      const exists = existsSync(dbPath);
      console.log(`${slug} (db: ${exists ? "exists" : "missing"}, keys: ${info.keys.length})`);
    }
  }

} else if (command === "delete-project") {
  const slug = args[0];
  if (!slug) {
    console.error("Usage: agent-backlog-api delete-project <slug>");
    process.exit(1);
  }
  const keys = loadApiKeys();
  let found = false;
  for (const [key, entry] of Object.entries(keys)) {
    if (entry.slug === slug) {
      delete keys[key];
      found = true;
    }
  }
  if (!found) {
    console.error(`Project "${slug}" not found.`);
    process.exit(1);
  }
  saveApiKeys(keys);
  // Close and remove from pool if cached
  if (storePool.has(slug)) {
    storePool.get(slug).close();
    storePool.delete(slug);
  }
  const dbPath = join(DATA_DIR, `${slug}.backlog.db`);
  try {
    unlinkSync(dbPath);
    // Also remove WAL and SHM files
    try { unlinkSync(dbPath + "-wal"); } catch { /* ignore */ }
    try { unlinkSync(dbPath + "-shm"); } catch { /* ignore */ }
    console.log(`Project "${slug}" deleted (DB removed).`);
  } catch {
    console.log(`Project "${slug}" deleted (DB was already missing).`);
  }

} else if (command === "serve" || command === undefined) {
  const port = parseInt(process.env.BACKLOG_API_PORT ?? String(DEFAULT_PORT), 10);

  // Poll for SSE broadcasts
  const pollInterval = setInterval(() => {
    for (const slug of sseClients.keys()) {
      if (sseClients.get(slug).size > 0) {
        broadcastProject(slug);
      }
    }
  }, 2000);

  const httpServer = createServer(handleRequest);
  httpServer.listen(port, "0.0.0.0", () => {
    logger.info("api:started", { port });
    console.log(`Agent Backlog API server listening on http://0.0.0.0:${port}`);
  });

  function shutdown() {
    clearInterval(pollInterval);
    logger.info("api:shutdown", { port });
    // Close all active SSE connections so httpServer.close() can finish
    for (const [, clients] of sseClients) {
      for (const res of clients) {
        try { res.end(); } catch { /* ignore */ }
      }
    }
    sseClients.clear();
    for (const [, store] of storePool) {
      try { store.close(); } catch { /* ignore */ }
    }
    storePool.clear();
    httpServer.close(() => process.exit(0));
    // Force exit if server hasn't closed within 5 s
    setTimeout(() => process.exit(0), 5000).unref();
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

} else {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: agent-backlog-api [serve|create-project|list-projects|delete-project]");
  process.exit(1);
}
