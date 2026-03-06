#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { createServer } from "http";
import Database from "better-sqlite3";

// ── database path ─────────────────────────────────────────────────────────

function detectProjectRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
}

const DB_PATH = process.env.BACKLOG_FILE ?? join(detectProjectRoot(), ".backlog.db");

// ── database setup ────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 255),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'done')),
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES checklist_items(id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK(length(label) >= 1),
    checked INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    author TEXT NOT NULL DEFAULT 'agent' CHECK(author IN ('agent', 'human')),
    body TEXT NOT NULL CHECK(length(body) >= 1),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dependencies (
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    depends_on_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, depends_on_id),
    CHECK(item_id != depends_on_id)
  );

  CREATE INDEX IF NOT EXISTS idx_checklist_item ON checklist_items(item_id);
  CREATE INDEX IF NOT EXISTS idx_checklist_parent ON checklist_items(parent_id);
  CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_id);
  CREATE INDEX IF NOT EXISTS idx_dependencies_item ON dependencies(item_id);
  CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
`);

// ── prepared statements ───────────────────────────────────────────────────

const stmts = {
  listItems: db.prepare("SELECT * FROM items ORDER BY id"),
  listItemsByStatus: db.prepare("SELECT * FROM items WHERE status = ? ORDER BY id"),
  getItem: db.prepare("SELECT * FROM items WHERE id = ?"),
  createItem: db.prepare(
    "INSERT INTO items (title, status, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ),
  updateItem: db.prepare(
    "UPDATE items SET title = ?, description = ?, status = ?, updated_at = ? WHERE id = ?"
  ),

  getChecklist: db.prepare("SELECT * FROM checklist_items WHERE item_id = ? ORDER BY position"),
  getChecklistItem: db.prepare("SELECT * FROM checklist_items WHERE id = ? AND item_id = ?"),
  getChecklistByParent: db.prepare(
    "SELECT * FROM checklist_items WHERE item_id = ? AND parent_id = ? ORDER BY position"
  ),
  getTopChecklist: db.prepare(
    "SELECT * FROM checklist_items WHERE item_id = ? AND parent_id IS NULL ORDER BY position"
  ),
  countChecklistByParent: db.prepare(
    "SELECT COUNT(*) as cnt FROM checklist_items WHERE item_id = ? AND parent_id = ?"
  ),
  countTopChecklist: db.prepare(
    "SELECT COUNT(*) as cnt FROM checklist_items WHERE item_id = ? AND parent_id IS NULL"
  ),
  addChecklist: db.prepare(
    "INSERT INTO checklist_items (item_id, parent_id, label, checked, position) VALUES (?, ?, ?, 0, ?)"
  ),
  updateChecklist: db.prepare(
    "UPDATE checklist_items SET label = ?, checked = ? WHERE id = ?"
  ),
  deleteChecklist: db.prepare("DELETE FROM checklist_items WHERE id = ?"),
  getChecklistChildren: db.prepare("SELECT id FROM checklist_items WHERE parent_id = ?"),

  addComment: db.prepare(
    "INSERT INTO comments (item_id, author, body, created_at) VALUES (?, ?, ?, ?)"
  ),
  getComments: db.prepare("SELECT * FROM comments WHERE item_id = ? ORDER BY created_at"),

  getDeps: db.prepare("SELECT depends_on_id FROM dependencies WHERE item_id = ?"),
  addDep: db.prepare("INSERT OR IGNORE INTO dependencies (item_id, depends_on_id) VALUES (?, ?)"),
  removeDep: db.prepare("DELETE FROM dependencies WHERE item_id = ? AND depends_on_id = ?"),

  countChecklistTotal: db.prepare(
    "SELECT COUNT(*) as cnt FROM checklist_items WHERE item_id = ?"
  ),
  countChecklistDone: db.prepare(
    "SELECT COUNT(*) as cnt FROM checklist_items WHERE item_id = ? AND checked = 1"
  ),
};

// ── helpers ───────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

function ok(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function requireItem(id) {
  const item = stmts.getItem.get(id);
  if (!item) throw new Error(`BacklogItem ${id} not found`);
  return item;
}

function buildChecklistTree(itemId, parentId) {
  const rows = parentId === null
    ? stmts.getTopChecklist.all(itemId)
    : stmts.getChecklistByParent.all(itemId, parentId);

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    checked: !!row.checked,
    position: row.position,
    children: buildChecklistTree(itemId, row.id),
  }));
}

function fullItem(id) {
  const item = requireItem(id);
  return {
    ...item,
    checklist: buildChecklistTree(item.id, null),
    dependencies: stmts.getDeps.all(item.id).map((d) => ({ depends_on_id: d.depends_on_id })),
    comments: stmts.getComments.all(item.id),
  };
}

function summarize(item) {
  const total = stmts.countChecklistTotal.get(item.id).cnt;
  const done = stmts.countChecklistDone.get(item.id).cnt;
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    updated_at: item.updated_at,
    dependencies: stmts.getDeps.all(item.id).map((d) => d.depends_on_id),
    checklist: total > 0 ? { total, done } : undefined,
  };
}

function allSummaries(status) {
  const items = status ? stmts.listItemsByStatus.all(status) : stmts.listItems.all();
  return items.map(summarize);
}

function deleteChecklistRecursive(id) {
  const children = stmts.getChecklistChildren.all(id);
  for (const child of children) {
    deleteChecklistRecursive(child.id);
  }
  stmts.deleteChecklist.run(id);
}

// Cycle detection for dependencies
function wouldCycle(fromId, toId) {
  const visited = new Set();
  const stack = [toId];
  while (stack.length) {
    const node = stack.pop();
    if (node === fromId) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const dep of stmts.getDeps.all(node)) {
      stack.push(dep.depends_on_id);
    }
  }
  return false;
}

// ── SSE ───────────────────────────────────────────────────────────────────

const sseClients = new Set();

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

function broadcast() {
  broadcastSSE("update", allSummaries());
}

// ── MCP server ────────────────────────────────────────────────────────────

const server = new McpServer({ name: "agent-backlog", version: "2.0.0" });

// ── backlog items ─────────────────────────────────────────────────────────

server.tool(
  "backlog_list",
  "List backlog items, optionally filtered by status.",
  { status: z.enum(["open", "in_progress", "done"]).optional() },
  ({ status }) => ok(allSummaries(status))
);

server.tool(
  "backlog_get",
  "Get a single backlog item with its checklist and dependencies.",
  { id: z.number().int() },
  ({ id }) => ok(fullItem(id))
);

server.tool(
  "backlog_create",
  "Create a new backlog item.",
  {
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    status: z.enum(["open", "in_progress", "done"]).optional(),
  },
  ({ title, description = "", status = "open" }) => {
    const ts = now();
    const result = stmts.createItem.run(title, status, description, ts, ts);
    const item = fullItem(result.lastInsertRowid);
    broadcast();
    return ok(item);
  }
);

server.tool(
  "backlog_update",
  "Update a backlog item's title, description, or status.",
  {
    id: z.number().int(),
    title: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    status: z.enum(["open", "in_progress", "done"]).optional(),
  },
  ({ id, title, description, status }) => {
    const item = requireItem(id);
    stmts.updateItem.run(
      title ?? item.title,
      description ?? item.description,
      status ?? item.status,
      now(),
      id
    );
    const updated = fullItem(id);
    broadcast();
    return ok(updated);
  }
);

// ── checklist ─────────────────────────────────────────────────────────────

server.tool(
  "checklist_add",
  "Add a checklist item to a backlog item. Use parent_id to nest under an existing checklist item.",
  {
    item_id: z.number().int(),
    label: z.string().min(1),
    parent_id: z.number().int().optional(),
  },
  ({ item_id, label, parent_id }) => {
    requireItem(item_id);

    let position;
    if (parent_id !== undefined) {
      const parent = stmts.getChecklistItem.get(parent_id, item_id);
      if (!parent) throw new Error(`ChecklistItem ${parent_id} not found on BacklogItem ${item_id}`);
      position = stmts.countChecklistByParent.get(item_id, parent_id).cnt;
    } else {
      position = stmts.countTopChecklist.get(item_id).cnt;
    }

    const result = stmts.addChecklist.run(item_id, parent_id ?? null, label, position);
    const entry = {
      id: result.lastInsertRowid,
      label,
      checked: false,
      position,
      children: [],
    };
    broadcast();
    return ok(entry);
  }
);

server.tool(
  "checklist_update",
  "Update a checklist item's label or checked state.",
  {
    item_id: z.number().int(),
    id: z.number().int(),
    label: z.string().min(1).optional(),
    checked: z.boolean().optional(),
  },
  ({ item_id, id, label, checked }) => {
    const entry = stmts.getChecklistItem.get(id, item_id);
    if (!entry) throw new Error(`ChecklistItem ${id} not found on BacklogItem ${item_id}`);
    stmts.updateChecklist.run(
      label ?? entry.label,
      checked !== undefined ? (checked ? 1 : 0) : entry.checked,
      id
    );
    const updated = stmts.getChecklistItem.get(id, item_id);
    broadcast();
    return ok({ ...updated, checked: !!updated.checked });
  }
);

server.tool(
  "checklist_delete",
  "Delete a checklist item (cascades to children).",
  {
    item_id: z.number().int(),
    id: z.number().int(),
  },
  ({ item_id, id }) => {
    const entry = stmts.getChecklistItem.get(id, item_id);
    if (!entry) throw new Error(`ChecklistItem ${id} not found on BacklogItem ${item_id}`);
    deleteChecklistRecursive(id);
    broadcast();
    return ok({ deleted: id });
  }
);

// ── comments ──────────────────────────────────────────────────────────────

server.tool(
  "comment_add",
  "Append a comment to a backlog item. Comments are permanent and cannot be deleted. Author is always 'agent' via MCP; use the UI to add human comments.",
  {
    item_id: z.number().int(),
    body: z.string().min(1),
  },
  ({ item_id, body }) => {
    requireItem(item_id);
    const ts = now();
    const result = stmts.addComment.run(item_id, "agent", body, ts);
    stmts.updateItem.run(
      undefined, undefined, undefined, ts, item_id
    );
    // re-read to get proper values after partial update
    const item = requireItem(item_id);
    stmts.updateItem.run(item.title, item.description, item.status, ts, item_id);
    const comment = { id: Number(result.lastInsertRowid), author: "agent", body, created_at: ts };
    broadcast();
    return ok(comment);
  }
);

// ── dependencies ──────────────────────────────────────────────────────────

server.tool(
  "dependency_add",
  "Add a dependency: item_id depends on depends_on_id.",
  {
    item_id: z.number().int(),
    depends_on_id: z.number().int(),
  },
  ({ item_id, depends_on_id }) => {
    if (item_id === depends_on_id) throw new Error("An item cannot depend on itself");
    requireItem(item_id);
    requireItem(depends_on_id);

    if (wouldCycle(item_id, depends_on_id)) {
      throw new Error(`Adding this dependency would create a cycle: ${item_id} → ${depends_on_id}`);
    }

    stmts.addDep.run(item_id, depends_on_id);
    broadcast();
    return ok({ item_id, depends_on_id });
  }
);

server.tool(
  "dependency_remove",
  "Remove a dependency between two items.",
  {
    item_id: z.number().int(),
    depends_on_id: z.number().int(),
  },
  ({ item_id, depends_on_id }) => {
    const result = stmts.removeDep.run(item_id, depends_on_id);
    if (result.changes === 0) {
      throw new Error(`Dependency ${item_id} → ${depends_on_id} does not exist`);
    }
    broadcast();
    return ok({ removed: { item_id, depends_on_id } });
  }
);

// ── search ────────────────────────────────────────────────────────────────

server.tool(
  "backlog_search",
  "Search backlog items by one or more keywords. Supports quoted phrases (\"exact match\"). Items are ranked by relevance: title matches score higher than description matches. All tokens must appear somewhere in the item (AND logic by default). Optionally filter by status.",
  {
    query: z.string().min(1),
    status: z.enum(["open", "in_progress", "done"]).optional(),
  },
  ({ query, status }) => {
    const tokens = [];
    const phraseRe = /"([^"]+)"|(\S+)/g;
    let m;
    while ((m = phraseRe.exec(query)) !== null) {
      tokens.push((m[1] ?? m[2]).toLowerCase());
    }

    const items = status ? stmts.listItemsByStatus.all(status) : stmts.listItems.all();
    const scored = [];

    for (const item of items) {
      const titleLower = item.title.toLowerCase();
      const descLower = item.description.toLowerCase();

      const allMatch = tokens.every((t) => titleLower.includes(t) || descLower.includes(t));
      if (!allMatch) continue;

      let score = 0;
      for (const t of tokens) {
        if (titleLower.includes(t)) score += 2;
        if (descLower.includes(t)) score += 1;
      }
      scored.push({ score, item });
    }

    scored.sort((a, b) => b.score - a.score);
    return ok(scored.map((s) => summarize(s.item)));
  }
);

// ── HTTP UI server ────────────────────────────────────────────────────────

const UI_PORT = parseInt(process.env.BACKLOG_UI_PORT ?? "3456", 10);
const __dirname = dirname(fileURLToPath(import.meta.url));
const KANBAN_HTML = readFileSync(join(__dirname, "kanban.html"), "utf8");

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const httpServer = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${UI_PORT}`);

  try {
    // SSE
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: update\ndata: ${JSON.stringify(allSummaries())}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    // Kanban HTML
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(KANBAN_HTML);
      return;
    }

    // List items
    if (req.method === "GET" && url.pathname === "/api/items") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(allSummaries()));
      return;
    }

    // Single item routes
    const itemMatch = url.pathname.match(/^\/api\/items\/(\d+)$/);
    if (itemMatch) {
      const id = parseInt(itemMatch[1], 10);

      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(fullItem(id)));
        return;
      }

      if (req.method === "PATCH") {
        const fields = await parseBody(req);
        const item = requireItem(id);
        const allowed = ["title", "description", "status"];
        const title = allowed.includes("title") && fields.title !== undefined ? fields.title : item.title;
        const desc = allowed.includes("description") && fields.description !== undefined ? fields.description : item.description;
        const status = allowed.includes("status") && fields.status !== undefined ? fields.status : item.status;
        stmts.updateItem.run(title, desc, status, now(), id);
        const updated = fullItem(id);
        broadcast();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(updated));
        return;
      }

      if (req.method === "DELETE") {
        requireItem(id);
        db.prepare("DELETE FROM items WHERE id = ?").run(id);
        broadcast();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ deleted: id }));
        return;
      }
    }

    // Checklist routes
    const clMatch = url.pathname.match(/^\/api\/items\/(\d+)\/checklist(?:\/(\d+))?$/);
    if (clMatch) {
      const itemId = parseInt(clMatch[1], 10);
      const cid = clMatch[2] ? parseInt(clMatch[2], 10) : null;

      if (req.method === "POST" && cid === null) {
        const { label, parent_id } = await parseBody(req);
        if (!label || typeof label !== "string" || !label.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "label is required" }));
          return;
        }
        requireItem(itemId);
        if (parent_id != null) {
          const parent = stmts.getChecklistItem.get(parent_id, itemId);
          if (!parent) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "parent not found" }));
            return;
          }
        }
        const position = parent_id != null
          ? stmts.countChecklistByParent.get(itemId, parent_id).cnt
          : stmts.countTopChecklist.get(itemId).cnt;
        const result = stmts.addChecklist.run(itemId, parent_id ?? null, label.trim(), position);
        broadcast();
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: Number(result.lastInsertRowid), label: label.trim(), checked: false, position, children: [] }));
        return;
      }

      if (req.method === "PATCH" && cid !== null) {
        const fields = await parseBody(req);
        const entry = stmts.getChecklistItem.get(cid, itemId);
        if (!entry) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "checklist item not found" }));
          return;
        }
        stmts.updateChecklist.run(
          fields.label ?? entry.label,
          fields.checked !== undefined ? (fields.checked ? 1 : 0) : entry.checked,
          cid
        );
        const updated = stmts.getChecklistItem.get(cid, itemId);
        broadcast();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...updated, checked: !!updated.checked }));
        return;
      }

      if (req.method === "DELETE" && cid !== null) {
        const entry = stmts.getChecklistItem.get(cid, itemId);
        if (!entry) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "checklist item not found" }));
          return;
        }
        deleteChecklistRecursive(cid);
        broadcast();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ deleted: cid }));
        return;
      }
    }

    // Add human comment
    const commentMatch = url.pathname.match(/^\/api\/items\/(\d+)\/comments$/);
    if (commentMatch && req.method === "POST") {
      const id = parseInt(commentMatch[1], 10);
      const { body: commentBody } = await parseBody(req);
      if (!commentBody || typeof commentBody !== "string" || !commentBody.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "body is required" }));
        return;
      }
      requireItem(id);
      const ts = now();
      const result = stmts.addComment.run(id, "human", commentBody.trim(), ts);
      const item = requireItem(id);
      stmts.updateItem.run(item.title, item.description, item.status, ts, id);
      broadcast();
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: Number(result.lastInsertRowid), author: "human", body: commentBody.trim(), created_at: ts }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (e) {
    const code = e.message.includes("not found") ? 404 : 400;
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
});

httpServer.listen(UI_PORT, "0.0.0.0", () => {
  process.stderr.write(`Backlog DB: ${DB_PATH}\n`);
  process.stderr.write(`Backlog kanban UI: http://0.0.0.0:${UI_PORT}\n`);
});

// ── graceful shutdown ─────────────────────────────────────────────────────

process.on("SIGINT", () => { db.close(); process.exit(0); });
process.on("SIGTERM", () => { db.close(); process.exit(0); });

// ── start MCP ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
