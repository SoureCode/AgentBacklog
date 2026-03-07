#!/usr/bin/env node
// config.js must be the first local import: it loads config files into
// process.env before any other module reads env vars at evaluation time.
import { PROJECT_ROOT } from "./config.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { logger } from "./logger.js";
import { join } from "path";
import { request } from "http";
import { registerProject } from "./db.js";
import {
  tryBecomeUILeader, releaseUILeadership, getUILeaderPort,
} from "./db.js";
import { createStore, VersionConflictError } from "./store.js";
import { startUI, stopUI } from "./ui.js";
import { AgentStatusEnum, TitleField } from "./schemas.js";

const isRemoteMode = !!(process.env.BACKLOG_API_URL && process.env.BACKLOG_API_KEY);
const store = createStore({ projectRoot: PROJECT_ROOT });

// Register in local registry only in local mode
let slug;
if (!isRemoteMode) {
  const DB_PATH = process.env.BACKLOG_FILE ?? join(PROJECT_ROOT, ".backlog.db");
  slug = registerProject(PROJECT_ROOT, DB_PATH);
  logger.info("backlog:db", { db: DB_PATH, slug });
} else {
  slug = PROJECT_ROOT.split("/").pop();
  logger.info("backlog:remote", { url: process.env.BACKLOG_API_URL });
}

// ── helpers ───────────────────────────────────────────────────────────────

function ok(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function tool(name, desc, schema, handler) {
  server.tool(name, desc, schema, async (args) => {
    logger.debug("tool:call", { tool: name, args });
    try {
      const result = await handler(args);
      // Parse the payload back out so the log contains actual output, not the MCP wrapper
      let output;
      try { output = JSON.parse(result.content[0].text); } catch { output = null; }
      logger.debug("tool:ok", { tool: name, output });
      return result;
    } catch (err) {
      logger.error("tool:error", { tool: name, error: err.message });
      throw err;
    }
  });
}

// ── MCP server ────────────────────────────────────────────────────────────

const server = new McpServer({ name: "agent-backlog", version: "3.0.0" });

// ── backlog items ─────────────────────────────────────────────────────────

tool(
  "backlog_list",
  "List backlog items, optionally filtered by status. Each item includes a 'version' field for optimistic locking.",
  { status: AgentStatusEnum.optional() },
  async ({ status }) => ok(await store.listItems(status, { includeArchived: false }))
);

tool(
  "backlog_get",
  "Get a single backlog item with its full details. The returned 'version' field must be passed to any subsequent update operation on this item.",
  { id: z.number().int() },
  async ({ id }) => ok(await store.getItem(id))
);

tool(
  "backlog_create",
  "Create a new backlog item. Returns the item with version 1.",
  {
    title: TitleField,
    description: z.string().optional(),
    status: AgentStatusEnum.optional(),
  },
  async ({ title, description, status }) =>
    ok(await store.createItem({ title, description, status }))
);

tool(
  "backlog_update",
  "Update a backlog item's title, description, or status. Requires the 'version' from your last read of this item. If another agent modified the item since you read it, this will fail with a CONFLICT error — re-fetch with backlog_get and retry.",
  {
    id: z.number().int(),
    version: z.number().int().describe("The version number from your last backlog_get. Required for conflict detection."),
    title: TitleField.optional(),
    description: z.string().optional(),
    status: AgentStatusEnum.optional(),
  },
  async ({ id, version, title, description, status }) =>
    ok(await store.updateItem(id, { version, title, description, status }))
);

// ── checklist ─────────────────────────────────────────────────────────────

tool(
  "checklist_add",
  "Add a checklist item to a backlog item. Requires the item's current 'version' for conflict detection. Use parent_id to nest under an existing checklist item.",
  {
    item_id: z.number().int(),
    version: z.number().int().describe("The item's version number from your last backlog_get."),
    label: z.string().min(1),
    parent_id: z.number().int().optional(),
  },
  async ({ item_id, version, label, parent_id }) =>
    ok(await store.addChecklist(item_id, { version, label, parent_id }))
);

tool(
  "checklist_update",
  "Update a checklist item's label or checked state. Requires the parent item's current 'version' for conflict detection.",
  {
    item_id: z.number().int(),
    version: z.number().int().describe("The item's version number from your last backlog_get."),
    id: z.number().int(),
    label: z.string().min(1).optional(),
    checked: z.boolean().optional(),
  },
  async ({ item_id, version, id, label, checked }) =>
    ok(await store.updateChecklist(item_id, { version, id, label, checked }))
);

tool(
  "checklist_delete",
  "Delete a checklist item (cascades to children). Requires the parent item's current 'version' for conflict detection.",
  {
    item_id: z.number().int(),
    version: z.number().int().describe("The item's version number from your last backlog_get."),
    id: z.number().int(),
  },
  async ({ item_id, version, id }) =>
    ok(await store.deleteChecklist(item_id, { version, id }))
);

// ── comments ──────────────────────────────────────────────────────────────

tool(
  "comment_add",
  "Append a comment to a backlog item. Comments are append-only and do not require version checking. Author is always 'agent' via MCP; use the UI to add human comments.",
  {
    item_id: z.number().int(),
    body: z.string().min(1),
  },
  async ({ item_id, body }) =>
    ok(await store.addComment(item_id, { body }))
);

// ── dependencies ──────────────────────────────────────────────────────────

tool(
  "dependency_add",
  "Add a dependency: item_id depends on depends_on_id. Requires the item's current 'version' for conflict detection.",
  {
    item_id: z.number().int(),
    version: z.number().int().describe("The item's version number from your last backlog_get."),
    depends_on_id: z.number().int(),
  },
  async ({ item_id, version, depends_on_id }) =>
    ok(await store.addDependency(item_id, { version, depends_on_id }))
);

tool(
  "dependency_remove",
  "Remove a dependency between two items. Requires the item's current 'version' for conflict detection.",
  {
    item_id: z.number().int(),
    version: z.number().int().describe("The item's version number from your last backlog_get."),
    depends_on_id: z.number().int(),
  },
  async ({ item_id, version, depends_on_id }) =>
    ok(await store.removeDependency(item_id, { version, depends_on_id }))
);

// ── search ────────────────────────────────────────────────────────────────

tool(
  "backlog_search",
  "Search backlog items by one or more keywords. Supports quoted phrases (\"exact match\"). Items are ranked by relevance: title matches score higher than description matches. All tokens must appear somewhere in the item (AND logic). Optionally filter by status.",
  {
    query: z.string().min(1),
    status: AgentStatusEnum.optional(),
  },
  async ({ query, status }) =>
    ok(await store.searchItems(query, status, { includeArchived: false }))
);

// ── soft-delete ──────────────────────────────────────────────────────────

tool(
  "backlog_delete",
  "Soft-delete a backlog item by setting its status to 'archived'. The item remains in the database and is visible in the kanban UI, but is hidden from backlog_list and backlog_search. Requires the item's current 'version' for conflict detection.",
  {
    id: z.number().int(),
    version: z.number().int().describe("The version number from your last backlog_get. Required for conflict detection."),
  },
  async ({ id, version }) =>
    ok(await store.updateItem(id, { version, status: "archived" }))
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

  uiServer.on("error", (err) => {
    logger.error("ui:server-error", { error: err.message });
    releaseUILeadership();
    isUILeader = false;
    uiServer = null;
  });

  uiServer.on("close", () => {
    if (isUILeader) {
      logger.warn("ui:closed-unexpectedly");
      releaseUILeadership();
      isUILeader = false;
      uiServer = null;
    }
  });

  logger.info("ui:started", { port: UI_PORT });
  return true;
}

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
  logger.info("ui:already-running", { port: lock ?? UI_PORT });
}

const leaderCheckInterval = setInterval(async () => {
  if (isUILeader) {
    if (!uiServer || !uiServer.listening) {
      logger.warn("ui:not-listening-restarting");
      releaseUILeadership();
      isUILeader = false;
      uiServer = null;
      await claimAndStartUI();
    }
    return;
  }

  const port = getUILeaderPort();
  if (port === null) {
    logger.info("ui:leader-gone-takeover");
    await claimAndStartUI();
    return;
  }

  const alive = await healthCheckUI(port);
  if (!alive) {
    logger.warn("ui:leader-not-responding-takeover", { port });
    await claimAndStartUI();
  }
}, 5000);

// ── graceful shutdown ─────────────────────────────────────────────────────

function shutdown() {
  clearInterval(leaderCheckInterval);
  if (isUILeader) {
    logger.info("ui:leadership-released");
    releaseUILeadership();
    stopUI();
  }
  store.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── start MCP ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
