#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join } from "path";
import { request } from "http";
import { execSync } from "child_process";
import {
  openDatabase, prepareStatements, registerProject,
  now, requireItem, fullItem, allSummaries, deleteChecklistRecursive, wouldCycle,
  VersionConflictError, requireVersion, bumpVersion,
  tryBecomeUILeader, releaseUILeadership, getUILeaderPort,
} from "./db.js";
import { startUI, stopUI } from "./ui.js";

// ── database path ─────────────────────────────────────────────────────────

function detectProjectRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
}

const PROJECT_ROOT = detectProjectRoot();
const DB_PATH = process.env.BACKLOG_FILE ?? join(PROJECT_ROOT, ".backlog.db");

// ── database ──────────────────────────────────────────────────────────────

const db = openDatabase(DB_PATH);
const stmts = prepareStatements(db);

// Register this project in the central registry so the UI can find it
const slug = registerProject(PROJECT_ROOT, DB_PATH);
process.stderr.write(`Backlog DB: ${DB_PATH} (registered as "${slug}")\n`);

// ── helpers ───────────────────────────────────────────────────────────────

function ok(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

// ── MCP server ────────────────────────────────────────────────────────────

const server = new McpServer({ name: "agent-backlog", version: "3.0.0" });

// ── backlog items ─────────────────────────────────────────────────────────

server.tool(
  "backlog_list",
  "List backlog items, optionally filtered by status. Each item includes a 'version' field for optimistic locking.",
  { status: z.enum(["open", "in_progress", "done"]).optional() },
  ({ status }) => ok(allSummaries(stmts, status))
);

server.tool(
  "backlog_get",
  "Get a single backlog item with its full details. The returned 'version' field must be passed to any subsequent update operation on this item.",
  { id: z.number().int() },
  ({ id }) => ok(fullItem(stmts, id))
);

server.tool(
  "backlog_create",
  "Create a new backlog item. Returns the item with version 1.",
  {
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    status: z.enum(["open", "in_progress", "done"]).optional(),
  },
  ({ title, description = "", status = "open" }) => {
    const ts = now();
    const result = stmts.createItem.run(title, status, description, ts, ts);
    return ok(fullItem(stmts, result.lastInsertRowid));
  }
);

server.tool(
  "backlog_update",
  "Update a backlog item's title, description, or status. Requires the 'version' from your last read of this item. If another agent modified the item since you read it, this will fail with a CONFLICT error — re-fetch with backlog_get and retry.",
  {
    id: z.number().int(),
    version: z.number().int().describe("The version number from your last backlog_get. Required for conflict detection."),
    title: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    status: z.enum(["open", "in_progress", "done"]).optional(),
  },
  ({ id, version, title, description, status }) => {
    const item = requireVersion(stmts, id, version);
    const result = stmts.updateItem.run(
      title ?? item.title,
      description ?? item.description,
      status ?? item.status,
      now(),
      id,
      version
    );
    if (result.changes === 0) {
      throw new VersionConflictError(id, version, fullItem(stmts, id));
    }
    return ok(fullItem(stmts, id));
  }
);

// ── checklist ─────────────────────────────────────────────────────────────

server.tool(
  "checklist_add",
  "Add a checklist item to a backlog item. Requires the item's current 'version' for conflict detection. Use parent_id to nest under an existing checklist item.",
  {
    item_id: z.number().int(),
    version: z.number().int().describe("The item's version number from your last backlog_get."),
    label: z.string().min(1),
    parent_id: z.number().int().optional(),
  },
  ({ item_id, version, label, parent_id }) => {
    requireVersion(stmts, item_id, version);

    let position;
    if (parent_id !== undefined) {
      const parent = stmts.getChecklistItem.get(parent_id, item_id);
      if (!parent) throw new Error(`ChecklistItem ${parent_id} not found on BacklogItem ${item_id}`);
      position = stmts.countChecklistByParent.get(item_id, parent_id).cnt;
    } else {
      position = stmts.countTopChecklist.get(item_id).cnt;
    }

    const result = stmts.addChecklist.run(item_id, parent_id ?? null, label, position);
    bumpVersion(stmts, item_id, version);
    return ok({
      id: Number(result.lastInsertRowid),
      label,
      checked: false,
      position,
      children: [],
      item_version: version + 1,
    });
  }
);

server.tool(
  "checklist_update",
  "Update a checklist item's label or checked state. Requires the parent item's current 'version' for conflict detection.",
  {
    item_id: z.number().int(),
    version: z.number().int().describe("The item's version number from your last backlog_get."),
    id: z.number().int(),
    label: z.string().min(1).optional(),
    checked: z.boolean().optional(),
  },
  ({ item_id, version, id, label, checked }) => {
    requireVersion(stmts, item_id, version);
    const entry = stmts.getChecklistItem.get(id, item_id);
    if (!entry) throw new Error(`ChecklistItem ${id} not found on BacklogItem ${item_id}`);
    stmts.updateChecklist.run(
      label ?? entry.label,
      checked !== undefined ? (checked ? 1 : 0) : entry.checked,
      id
    );
    bumpVersion(stmts, item_id, version);
    const updated = stmts.getChecklistItem.get(id, item_id);
    return ok({ ...updated, checked: !!updated.checked, item_version: version + 1 });
  }
);

server.tool(
  "checklist_delete",
  "Delete a checklist item (cascades to children). Requires the parent item's current 'version' for conflict detection.",
  {
    item_id: z.number().int(),
    version: z.number().int().describe("The item's version number from your last backlog_get."),
    id: z.number().int(),
  },
  ({ item_id, version, id }) => {
    requireVersion(stmts, item_id, version);
    const entry = stmts.getChecklistItem.get(id, item_id);
    if (!entry) throw new Error(`ChecklistItem ${id} not found on BacklogItem ${item_id}`);
    deleteChecklistRecursive(stmts, id);
    bumpVersion(stmts, item_id, version);
    return ok({ deleted: id, item_version: version + 1 });
  }
);

// ── comments ──────────────────────────────────────────────────────────────

server.tool(
  "comment_add",
  "Append a comment to a backlog item. Comments are append-only and do not require version checking. Author is always 'agent' via MCP; use the UI to add human comments.",
  {
    item_id: z.number().int(),
    body: z.string().min(1),
  },
  ({ item_id, body }) => {
    const item = requireItem(stmts, item_id);
    const ts = now();
    const result = stmts.addComment.run(item_id, "agent", body, ts);
    stmts.touchItem.run(ts, item_id, item.version);
    return ok({ id: Number(result.lastInsertRowid), author: "agent", body, created_at: ts });
  }
);

// ── dependencies ──────────────────────────────────────────────────────────

server.tool(
  "dependency_add",
  "Add a dependency: item_id depends on depends_on_id. Requires the item's current 'version' for conflict detection.",
  {
    item_id: z.number().int(),
    version: z.number().int().describe("The item's version number from your last backlog_get."),
    depends_on_id: z.number().int(),
  },
  ({ item_id, version, depends_on_id }) => {
    if (item_id === depends_on_id) throw new Error("An item cannot depend on itself");
    requireVersion(stmts, item_id, version);
    requireItem(stmts, depends_on_id);

    if (wouldCycle(stmts, item_id, depends_on_id)) {
      throw new Error(`Adding this dependency would create a cycle: ${item_id} → ${depends_on_id}`);
    }

    stmts.addDep.run(item_id, depends_on_id);
    bumpVersion(stmts, item_id, version);
    return ok({ item_id, depends_on_id, item_version: version + 1 });
  }
);

server.tool(
  "dependency_remove",
  "Remove a dependency between two items. Requires the item's current 'version' for conflict detection.",
  {
    item_id: z.number().int(),
    version: z.number().int().describe("The item's version number from your last backlog_get."),
    depends_on_id: z.number().int(),
  },
  ({ item_id, version, depends_on_id }) => {
    requireVersion(stmts, item_id, version);
    const result = stmts.removeDep.run(item_id, depends_on_id);
    if (result.changes === 0) {
      throw new Error(`Dependency ${item_id} → ${depends_on_id} does not exist`);
    }
    bumpVersion(stmts, item_id, version);
    return ok({ removed: { item_id, depends_on_id }, item_version: version + 1 });
  }
);

// ── search ────────────────────────────────────────────────────────────────

server.tool(
  "backlog_search",
  "Search backlog items by one or more keywords. Supports quoted phrases (\"exact match\"). Items are ranked by relevance: title matches score higher than description matches. All tokens must appear somewhere in the item (AND logic). Optionally filter by status.",
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
    return ok(scored.map((s) => ({ ...s.item, version: s.item.version })));
  }
);

// ── UI leader election ────────────────────────────────────────────────────

const UI_PORT = parseInt(process.env.BACKLOG_UI_PORT ?? "3456", 10);
let isUILeader = false;
let uiServer = null;

async function claimAndStartUI() {
  const result = tryBecomeUILeader(UI_PORT);
  if (!result.isLeader) return false;
  isUILeader = true;
  uiServer = await startUI(UI_PORT);

  // If the HTTP server crashes, release leadership so another session can take over
  uiServer.on("error", (err) => {
    process.stderr.write(`UI server error: ${err.message}\n`);
    releaseUILeadership();
    isUILeader = false;
    uiServer = null;
  });

  // If the server closes unexpectedly (not from our shutdown), release
  uiServer.on("close", () => {
    if (isUILeader) {
      process.stderr.write("UI server closed unexpectedly, releasing leadership\n");
      releaseUILeadership();
      isUILeader = false;
      uiServer = null;
    }
  });

  process.stderr.write(`Backlog UI started: http://localhost:${UI_PORT}\n`);
  return true;
}

// Health check: actually try to connect to the port, don't just trust PID
function healthCheckUI(port) {
  return new Promise((resolve) => {
    const req = request({ hostname: "127.0.0.1", port, path: "/api/projects", method: "GET", timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

await claimAndStartUI();
if (!isUILeader) {
  const lock = getUILeaderPort();
  process.stderr.write(`Backlog UI already running on port ${lock ?? UI_PORT}\n`);
}

// Periodically:
// - Non-leaders: check if leader is alive via HTTP health check, take over if dead
// - Leaders: self-check that our HTTP server is still listening, restart if crashed
const leaderCheckInterval = setInterval(async () => {
  if (isUILeader) {
    // Self-check: is our server still actually listening?
    if (!uiServer || !uiServer.listening) {
      process.stderr.write("UI server no longer listening, restarting...\n");
      releaseUILeadership();
      isUILeader = false;
      uiServer = null;
      await claimAndStartUI();
    }
    return;
  }

  // Non-leader: check if UI is reachable
  const port = getUILeaderPort();
  if (port === null) {
    // Lock gone — PID dead, take over immediately
    process.stderr.write("UI leader gone, attempting takeover...\n");
    await claimAndStartUI();
    return;
  }

  // Lock exists and PID alive — but is the HTTP server actually responding?
  const alive = await healthCheckUI(port);
  if (!alive) {
    process.stderr.write("UI leader not responding, attempting takeover...\n");
    await claimAndStartUI();
  }
}, 5000);

// ── graceful shutdown ─────────────────────────────────────────────────────

function shutdown() {
  clearInterval(leaderCheckInterval);
  if (isUILeader) {
    releaseUILeadership();
    stopUI();
  }
  db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── start MCP ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
