#!/usr/bin/env node
// config.js must be the first local import: it loads config files into
// process.env before any other module reads env vars at evaluation time.
import { PROJECT_ROOT, API_URL, API_KEY, BACKLOG_FILE } from "@sourecode/agent-backlog-core/config.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "@sourecode/agent-backlog-core/logger.js";
import { registerProject, resolveProjectDb, migrateAllProjects } from "@sourecode/agent-backlog-core/db/registry.js";
import { createStore, VersionConflictError } from "@sourecode/agent-backlog-core/store.js";
import { registerItemTools } from "./tools/items.js";
import { registerChecklistTools } from "./tools/checklists.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerDependencyTools } from "./tools/dependencies.js";
import { createUIManager } from "./ui/manager.js";

const isRemoteMode = !!(API_URL && API_KEY);
const store = createStore({ projectRoot: PROJECT_ROOT });

// Migrate existing project DBs to ~/.config/agent-backlog/data/ if needed
migrateAllProjects();

// Register in local registry only in local mode
if (!isRemoteMode) {
  const { slug, dbPath } = resolveProjectDb(PROJECT_ROOT);
  const DB_PATH = BACKLOG_FILE ?? dbPath;
  registerProject(PROJECT_ROOT, DB_PATH);
  logger.info("backlog:db", { db: DB_PATH, slug });
} else {
  logger.info("backlog:remote", { url: API_URL });
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
      try { output = JSON.parse(result.content[0].text); } catch (e) { logger.warn("tool:output-parse-error", { tool: name, error: e.message }); output = null; }
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

// ── register tools ────────────────────────────────────────────────────────

registerItemTools(server, store, tool, ok);
registerChecklistTools(server, store, tool, ok);
registerCommentTools(server, store, tool, ok);
registerDependencyTools(server, store, tool, ok);

// ── UI manager ────────────────────────────────────────────────────────────

const uiManager = createUIManager();
await uiManager.start();

// ── graceful shutdown ─────────────────────────────────────────────────────

function shutdown() {
  uiManager.stop();
  store.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── start MCP ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
