#!/usr/bin/env node
import { createServer } from "http";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { VersionConflictError } from "@sourecode/agent-backlog-core/db/errors.js";
import { tryBecomeUILeader, releaseUILeadership } from "@sourecode/agent-backlog-core/db/leader.js";
import { allSummaries } from "@sourecode/agent-backlog-core/db/queries.js";
import { closeDatabase } from "@sourecode/agent-backlog-core/db/schema.js";
import { json, parsePositiveInt } from "@sourecode/agent-backlog-core/http/helpers.js";
import { logger } from "@sourecode/agent-backlog-core/logger.js";
import { remoteListProjects, remoteProxyRequest } from "./remote/proxy.js";
import { dbPool, sse, getProject, listProjects, broadcastProject } from "./local/pool.js";
import { readLastLogLines, streamLogTail } from "./local/logs.js";
import { handleGetItem } from "./routes/items/get.js";
import { handleUpdateItem } from "./routes/items/update.js";
import { handleDeleteItem } from "./routes/items/delete.js";
import { handleAddChecklist } from "./routes/checklists/add.js";
import { handleUpdateChecklist } from "./routes/checklists/update.js";
import { handleDeleteChecklist } from "./routes/checklists/delete.js";
import { handleAddComment } from "./routes/comments/add.js";
import { handleAddDependency } from "./routes/dependencies/add.js";
import { handleDeleteDependency } from "./routes/dependencies/delete.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KANBAN_HTML = readFileSync(join(__dirname, "kanban.html"), "utf8");

// ── remote mode detection ─────────────────────────────────────────────────

import { API_URL, API_KEY, UI_PORT, UI_HOST } from "@sourecode/agent-backlog-core/config.js";
const REMOTE_API_URL = API_URL;
const REMOTE_API_KEY = API_KEY;
const isRemoteMode = !!(REMOTE_API_URL && REMOTE_API_KEY);

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

      const projectMatch = url.pathname.match(/^\/api\/projects\/(.+)$/);
      if (projectMatch) {
        await remoteProxyRequest("/" + projectMatch[1], req, res);
        return;
      }

      json(res, 404, { error: "Not found" });
      return;
    }

    // ── Local mode: direct DB access ────────────────────────────────────

    if (req.method === "GET" && url.pathname === "/api/projects") {
      json(res, 200, listProjects());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/logs") {
      const n = Math.min(parseInt(url.searchParams.get("lines") ?? "200", 10) || 200, 2000);
      const skip = Math.max(parseInt(url.searchParams.get("skip") ?? "0", 10) || 0, 0);
      json(res, 200, readLastLogLines(n, skip));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/logs/stream") {
      streamLogTail(res);
      return;
    }

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
      const cleanup = sse.register(slug, res, allSummaries(stmts));
      req.on("close", cleanup);
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
      let result = null;
      if (req.method === "GET") result = handleGetItem(stmts, id);
      else if (req.method === "PATCH") result = handleUpdateItem(stmts, slug, req, id);
      else if (req.method === "DELETE") result = handleDeleteItem(stmts, slug, id);
      if (result) {
        const resolved = typeof result === "function" ? await result() : result;
        if (resolved.headers) {
          res.writeHead(resolved.status, { "Content-Type": "application/json", ...resolved.headers });
          res.end(JSON.stringify(resolved.body));
        } else {
          json(res, resolved.status, resolved.body);
        }
        return;
      }
    }

    // Checklist routes
    const clMatch = path.match(/^\/items\/(\d+)\/checklist(?:\/(\d+))?$/);
    if (clMatch) {
      const itemId = parsePositiveInt(clMatch[1], "item_id");
      const cid = clMatch[2] ? parsePositiveInt(clMatch[2], "cid") : null;
      let result = null;
      if (req.method === "POST" && cid === null) result = handleAddChecklist(stmts, slug, req, itemId);
      else if (req.method === "PATCH" && cid !== null) result = handleUpdateChecklist(stmts, slug, req, itemId, cid);
      else if (req.method === "DELETE" && cid !== null) result = handleDeleteChecklist(stmts, slug, itemId, cid);
      if (result) {
        const resolved = typeof result === "function" ? await result() : result;
        json(res, resolved.status, resolved.body);
        return;
      }
    }

    // Add human comment
    const commentMatch = path.match(/^\/items\/(\d+)\/comments$/);
    if (commentMatch) {
      const id = parsePositiveInt(commentMatch[1], "item_id");
      if (req.method === "POST") {
        const result = handleAddComment(stmts, slug, req, id);
        if (result) {
          const resolved = typeof result === "function" ? await result() : result;
          json(res, resolved.status, resolved.body);
          return;
        }
      }
    }

    // Dependency routes
    const depMatch = path.match(/^\/items\/(\d+)\/dependencies(?:\/(\d+))?$/);
    if (depMatch) {
      const itemId = parsePositiveInt(depMatch[1], "item_id");
      const depId = depMatch[2] ? parsePositiveInt(depMatch[2], "dep_id") : null;
      let result = null;
      if (req.method === "POST" && depId === null) result = handleAddDependency(stmts, slug, req, itemId);
      else if (req.method === "DELETE" && depId !== null) result = handleDeleteDependency(stmts, slug, req, itemId, depId);
      if (result) {
        const resolved = typeof result === "function" ? await result() : result;
        json(res, resolved.status, resolved.body);
        return;
      }
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

let httpServer = null;

export function startUI(port, host = UI_HOST) {
  httpServer = createServer(handleRequest);

  return new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      resolve(httpServer);
    });
  });
}

export function stopUI() {
  sse.closeAll();
  for (const { db } of dbPool.values()) {
    try { closeDatabase(db); } catch (e) { logger.warn("ui:db-close-error", { error: e.message }); }
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
  const port = UI_PORT;
  const host = UI_HOST;
  const { isLeader } = tryBecomeUILeader(port);
  if (!isLeader) {
    console.log(`UI already running (see lock file). Use a different port or stop the other instance.`);
    process.exit(1);
  }

  await startUI(port, host);
  console.log(`Backlog UI: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  if (isRemoteMode) {
    console.log(`Remote mode: proxying to ${REMOTE_API_URL}`);
  }

  function shutdown() {
    releaseUILeadership();
    stopUI();
    setTimeout(() => process.exit(0), 1000).unref();
    process.exitCode = 0;
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
