#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, watch } from "fs";
import { randomUUID } from "crypto";
import { createServer } from "http";

const FILE_PATH = process.env.BACKLOG_FILE ?? join(process.cwd(), "agent-backlog.json");

// ── schema validation ──────────────────────────────────────────────────────

const ChecklistItemSchema = z.object({
  id: z.number().int().positive(),
  label: z.string().min(1),
  checked: z.boolean(),
  position: z.number().int().min(0),
  children: z.lazy(() => z.array(ChecklistItemSchema)).default([]),
});

const CommentSchema = z.object({
  id: z.number().int().positive(),
  author: z.enum(["agent", "human"]).default("agent"),
  body: z.string().min(1),
  created_at: z.string().datetime(),
});

const BacklogItemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(255),
  status: z.enum(["open", "in_progress", "done"]),
  description: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  checklist: z.array(ChecklistItemSchema).default([]),
  dependencies: z.array(z.object({ depends_on_id: z.number().int().positive() })).default([]),
  comments: z.array(CommentSchema).default([]),
});

const StoreSchema = z.object({
  nextId: z.number().int().positive(),
  nextChecklistId: z.number().int().positive(),
  nextCommentId: z.number().int().positive(),
  items: z.array(BacklogItemSchema),
});

// ── persistence ────────────────────────────────────────────────────────────

function load() {
  if (!existsSync(FILE_PATH)) {
    return { nextId: 1, nextChecklistId: 1, nextCommentId: 1, items: [] };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(FILE_PATH, "utf8"));
  } catch {
    throw new Error(`Failed to parse ${FILE_PATH}: file is not valid JSON`);
  }
  const result = StoreSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Data integrity error in ${FILE_PATH}: ${result.error.message}`);
  }
  return result.data;
}

function save(data) {
  // validate before writing
  StoreSchema.parse(data);

  // atomic write: write to tmp then rename
  const dir = dirname(FILE_PATH);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.agent-backlog-${randomUUID()}.tmp`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, FILE_PATH);

  // Broadcast update to SSE clients immediately (file watcher is unreliable
  // after atomic rename because the inode changes)
  broadcastSSE("update", data.items.map(summarize));
}

function now() {
  return new Date().toISOString();
}

// ── helpers ────────────────────────────────────────────────────────────────

function getItem(data, id) {
  const item = data.items.find((i) => i.id === id);
  if (!item) throw new Error(`BacklogItem ${id} not found`);
  return item;
}

function ok(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function summarize(item) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    updated_at: item.updated_at,
    dependencies: item.dependencies.map((d) => d.depends_on_id),
    checklist: item.checklist.length
      ? { total: countChecklist(item.checklist), done: countChecklist(item.checklist, true) }
      : undefined,
  };
}

function countChecklist(checklist, checked) {
  let n = 0;
  for (const c of checklist) {
    if (checked === undefined || c.checked === checked) n++;
    n += countChecklist(c.children ?? [], checked);
  }
  return n;
}

// Collect all dependency edges as a map: id → Set<depends_on_id>
function buildDepGraph(data) {
  const graph = new Map();
  for (const item of data.items) {
    graph.set(item.id, new Set(item.dependencies.map((d) => d.depends_on_id)));
  }
  return graph;
}

// Returns true if adding edge from → to would create a cycle
function wouldCycle(graph, from, to) {
  const visited = new Set();
  const stack = [to];
  while (stack.length) {
    const node = stack.pop();
    if (node === from) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const dep of graph.get(node) ?? []) stack.push(dep);
  }
  return false;
}

function allChecklistIds(checklist) {
  const ids = [];
  for (const c of checklist) {
    ids.push(c.id);
    ids.push(...allChecklistIds(c.children ?? []));
  }
  return ids;
}

function findChecklist(checklist, id) {
  for (const c of checklist) {
    if (c.id === id) return c;
    const found = findChecklist(c.children ?? [], id);
    if (found) return found;
  }
  return null;
}

function removeChecklist(checklist, id) {
  const idx = checklist.findIndex((c) => c.id === id);
  if (idx !== -1) { checklist.splice(idx, 1); return true; }
  for (const c of checklist) {
    if (removeChecklist(c.children ?? [], id)) return true;
  }
  return false;
}

// ── server ─────────────────────────────────────────────────────────────────

const server = new McpServer({ name: "agent-backlog", version: "1.0.0" });

// ── backlog items ──────────────────────────────────────────────────────────

server.tool(
  "backlog_list",
  "List backlog items, optionally filtered by status.",
  { status: z.enum(["open", "in_progress", "done"]).optional() },
  ({ status }) => {
    const data = load();
    const items = status ? data.items.filter((i) => i.status === status) : data.items;
    return ok(items.map(summarize));
  }
);

server.tool(
  "backlog_get",
  "Get a single backlog item with its checklist and dependencies.",
  { id: z.number().int() },
  ({ id }) => {
    const data = load();
    return ok(getItem(data, id));
  }
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
    const data = load();
    const item = {
      id: data.nextId++,
      title,
      status,
      description,
      created_at: now(),
      updated_at: now(),
      checklist: [],
      dependencies: [],
      comments: [],
    };
    data.items.push(item);
    save(data);
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
  ({ id, ...fields }) => {
    const data = load();
    const item = getItem(data, id);
    Object.assign(item, fields, { updated_at: now() });
    save(data);
    return ok(item);
  }
);

// ── checklist ──────────────────────────────────────────────────────────────

server.tool(
  "checklist_add",
  "Add a checklist item to a backlog item. Use parent_id to nest under an existing checklist item.",
  {
    item_id: z.number().int(),
    label: z.string().min(1),
    parent_id: z.number().int().optional(),
  },
  ({ item_id, label, parent_id }) => {
    const data = load();
    const item = getItem(data, item_id);

    // ensure parent_id belongs to the same backlog item, not another
    if (parent_id !== undefined) {
      const allIds = allChecklistIds(item.checklist);
      if (!allIds.includes(parent_id)) {
        throw new Error(`ChecklistItem ${parent_id} not found on BacklogItem ${item_id}`);
      }
    }

    const entry = {
      id: data.nextChecklistId++,
      label,
      checked: false,
      position: 0,
      children: [],
    };

    if (parent_id !== undefined) {
      const parent = findChecklist(item.checklist, parent_id);
      entry.position = parent.children.length;
      parent.children.push(entry);
    } else {
      entry.position = item.checklist.length;
      item.checklist.push(entry);
    }

    save(data);
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
  ({ item_id, id, ...fields }) => {
    const data = load();
    const item = getItem(data, item_id);
    const entry = findChecklist(item.checklist, id);
    if (!entry) throw new Error(`ChecklistItem ${id} not found on BacklogItem ${item_id}`);
    Object.assign(entry, fields);
    save(data);
    return ok(entry);
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
    const data = load();
    const item = getItem(data, item_id);
    if (!removeChecklist(item.checklist, id))
      throw new Error(`ChecklistItem ${id} not found on BacklogItem ${item_id}`);
    save(data);
    return ok({ deleted: id });
  }
);

// ── comments ───────────────────────────────────────────────────────────────

server.tool(
  "comment_add",
  "Append a comment to a backlog item. Comments are permanent and cannot be deleted. Author is always 'agent' via MCP; use the UI to add human comments.",
  {
    item_id: z.number().int(),
    body: z.string().min(1),
  },
  ({ item_id, body }) => {
    const author = "agent";
    const data = load();
    const item = getItem(data, item_id);
    const comment = {
      id: data.nextCommentId++,
      author,
      body,
      created_at: now(),
    };
    item.comments.push(comment);
    item.updated_at = now();
    save(data);
    return ok(comment);
  }
);

// ── dependencies ───────────────────────────────────────────────────────────

server.tool(
  "dependency_add",
  "Add a dependency: item_id depends on depends_on_id.",
  {
    item_id: z.number().int(),
    depends_on_id: z.number().int(),
  },
  ({ item_id, depends_on_id }) => {
    if (item_id === depends_on_id) throw new Error("An item cannot depend on itself");
    const data = load();
    const item = getItem(data, item_id);
    getItem(data, depends_on_id); // FK check

    const graph = buildDepGraph(data);
    if (wouldCycle(graph, item_id, depends_on_id)) {
      throw new Error(
        `Adding this dependency would create a cycle: ${item_id} → ${depends_on_id}`
      );
    }

    if (!item.dependencies.some((d) => d.depends_on_id === depends_on_id)) {
      item.dependencies.push({ depends_on_id });
    }
    save(data);
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
    const data = load();
    const item = getItem(data, item_id);
    const before = item.dependencies.length;
    item.dependencies = item.dependencies.filter((d) => d.depends_on_id !== depends_on_id);
    if (item.dependencies.length === before) {
      throw new Error(`Dependency ${item_id} → ${depends_on_id} does not exist`);
    }
    save(data);
    return ok({ removed: { item_id, depends_on_id } });
  }
);

// ── search ─────────────────────────────────────────────────────────────────

server.tool(
  "backlog_search",
  "Search backlog items by one or more keywords. Supports quoted phrases (\"exact match\"). Items are ranked by relevance: title matches score higher than description matches. All tokens must appear somewhere in the item (AND logic by default). Optionally filter by status.",
  {
    query: z.string().min(1),
    status: z.enum(["open", "in_progress", "done"]).optional(),
  },
  ({ query, status }) => {
    const data = load();

    // Parse tokens: quoted phrases stay together, other words are individual tokens
    const tokens = [];
    const phraseRe = /"([^"]+)"|(\S+)/g;
    let m;
    while ((m = phraseRe.exec(query)) !== null) {
      tokens.push((m[1] ?? m[2]).toLowerCase());
    }

    const scored = [];
    for (const item of data.items) {
      if (status && item.status !== status) continue;

      const titleLower = item.title.toLowerCase();
      const descLower = item.description.toLowerCase();

      // Every token must match somewhere (AND semantics)
      const allMatch = tokens.every((t) => titleLower.includes(t) || descLower.includes(t));
      if (!allMatch) continue;

      // Score: title hit = 2 pts each, description hit = 1 pt each
      let score = 0;
      for (const t of tokens) {
        if (titleLower.includes(t)) score += 2;
        if (descLower.includes(t)) score += 1;
      }

      scored.push({ score, item });
    }

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);
    return ok(scored.map((s) => summarize(s.item)));
  }
);

// ── HTTP UI server ────────────────────────────────────────────────────────

const UI_PORT = parseInt(process.env.BACKLOG_UI_PORT ?? "3456", 10);
const __dirname = dirname(fileURLToPath(import.meta.url));
const KANBAN_HTML = readFileSync(join(__dirname, "kanban.html"), "utf8");

// ── SSE clients ───────────────────────────────────────────────────────────

const sseClients = new Set();

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

// Watch the backlog file for changes and push to SSE clients
let watchDebounce = null;
function startFileWatcher() {
  if (!existsSync(FILE_PATH)) return;
  try {
    watch(FILE_PATH, () => {
      // Debounce: atomic write triggers multiple events
      clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        try {
          const data = load();
          broadcastSSE("update", data.items.map(summarize));
        } catch { /* ignore read errors during atomic write */ }
      }, 100);
    });
  } catch { /* watch not supported on this fs, clients fall back to polling */ }
}
startFileWatcher();

const httpServer = createServer((req, res) => {
  // CORS headers for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${UI_PORT}`);

  // SSE endpoint for live updates
  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    // Send initial data immediately
    try {
      const data = load();
      res.write(`event: update\ndata: ${JSON.stringify(data.items.map(summarize))}\n\n`);
    } catch { /* empty */ }
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // Serve kanban HTML
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(KANBAN_HTML);
    return;
  }

  // List items (summary)
  if (req.method === "GET" && url.pathname === "/api/items") {
    try {
      const data = load();
      const items = data.items.map(summarize);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(items));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Get single item (full detail)
  const itemMatch = url.pathname.match(/^\/api\/items\/(\d+)$/);
  if (itemMatch) {
    const id = parseInt(itemMatch[1], 10);

    if (req.method === "GET") {
      try {
        const data = load();
        const item = getItem(data, id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(item));
      } catch (e) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (req.method === "PATCH") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try {
          const fields = JSON.parse(body);
          const data = load();
          const item = getItem(data, id);
          const allowed = ["title", "description", "status"];
          for (const key of Object.keys(fields)) {
            if (allowed.includes(key)) item[key] = fields[key];
          }
          item.updated_at = now();
          save(data);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(item));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (req.method === "DELETE") {
      try {
        const data = load();
        const idx = data.items.findIndex((i) => i.id === id);
        if (idx === -1) throw new Error("Item not found: " + id);
        data.items.splice(idx, 1);
        save(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ deleted: id }));
      } catch (e) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
  }

  // Checklist routes: /api/items/:id/checklist[/:cid]
  const clMatch = url.pathname.match(/^\/api\/items\/(\d+)\/checklist(?:\/(\d+))?$/);
  if (clMatch) {
    const itemId = parseInt(clMatch[1], 10);
    const cid = clMatch[2] ? parseInt(clMatch[2], 10) : null;

    // POST — add checklist item
    if (req.method === "POST" && cid === null) {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try {
          const { label, parent_id } = JSON.parse(body);
          if (!label || typeof label !== "string" || !label.trim()) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "label is required" }));
            return;
          }
          const data = load();
          const item = getItem(data, itemId);
          if (parent_id !== undefined && parent_id !== null) {
            const allIds = allChecklistIds(item.checklist);
            if (!allIds.includes(parent_id)) {
              res.writeHead(404, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "parent not found" }));
              return;
            }
          }
          const entry = { id: data.nextChecklistId++, label: label.trim(), checked: false, position: 0, children: [] };
          if (parent_id !== undefined && parent_id !== null) {
            const parent = findChecklist(item.checklist, parent_id);
            entry.position = parent.children.length;
            parent.children.push(entry);
          } else {
            entry.position = item.checklist.length;
            item.checklist.push(entry);
          }
          item.updated_at = now();
          save(data);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify(entry));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // PATCH — update checklist item
    if (req.method === "PATCH" && cid !== null) {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try {
          const fields = JSON.parse(body);
          const data = load();
          const item = getItem(data, itemId);
          const entry = findChecklist(item.checklist, cid);
          if (!entry) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "checklist item not found" }));
            return;
          }
          if (fields.label !== undefined) entry.label = fields.label;
          if (fields.checked !== undefined) entry.checked = fields.checked;
          item.updated_at = now();
          save(data);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(entry));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // DELETE — delete checklist item
    if (req.method === "DELETE" && cid !== null) {
      try {
        const data = load();
        const item = getItem(data, itemId);
        if (!removeChecklist(item.checklist, cid)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "checklist item not found" }));
          return;
        }
        item.updated_at = now();
        save(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ deleted: cid }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
  }

  // Add human comment
  const commentMatch = url.pathname.match(/^\/api\/items\/(\d+)\/comments$/);
  if (commentMatch && req.method === "POST") {
    const id = parseInt(commentMatch[1], 10);
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { body: commentBody } = JSON.parse(body);
        if (!commentBody || typeof commentBody !== "string" || !commentBody.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "body is required" }));
          return;
        }
        const data = load();
        const item = getItem(data, id);
        const comment = {
          id: data.nextCommentId++,
          author: "human",
          body: commentBody.trim(),
          created_at: now(),
        };
        item.comments.push(comment);
        item.updated_at = now();
        save(data);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(comment));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(UI_PORT, "0.0.0.0", () => {
  // Write to stderr so it doesn't interfere with MCP stdio transport
  process.stderr.write(`Backlog kanban UI: http://0.0.0.0:${UI_PORT}\n`);
});

// ── start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
