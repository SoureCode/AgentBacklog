# Agent Backlog — Claude Code Guide

## Project Overview

Agent Backlog is an MCP plugin for Claude Code and GitHub Copilot CLI that provides task backlog management with a kanban UI. It has four packages:

- **`packages/core`** — SQLite store (local + remote), schemas, HTTP helpers, logger
- **`packages/api`** — Express REST API server for team/shared mode
- **`packages/mcp`** — MCP server exposing tools to agents
- **`packages/ui`** — Local kanban UI (SSE live updates, local + remote proxy mode)

## Key Design Decisions

### Agent safety: `backlog_delete` is a soft-delete

`backlog_delete` (MCP tool) does **not** hard-delete items. It moves them to an internal soft-deleted state (archived), invisible to agents but recoverable by humans via the UI or REST API. **Agents must never know about the "archived" status or the soft-delete mechanism** — from an agent's perspective the item is simply gone.

Hard delete is only available through the human-facing UI and REST API.

This is intentional and must not be changed. Do not expose the archive mechanism to agents.

### Optimistic locking

All mutating operations that could conflict require the item's current `version` number, which the agent reads from `backlog_get`. If another agent updated the item since the read, the operation returns a `CONFLICT` error — the agent must re-fetch and retry.

### Local vs remote mode

- **Local mode**: MCP server connects directly to SQLite via `LocalStore`
- **Remote/team mode**: MCP server proxies calls to the REST API via `RemoteStore`

The `store` abstraction (`packages/core/src/store/`) is the interface both modes implement.

### Leader election for the UI

Multiple MCP server instances (one per agent session) coordinate via a lock in the projects registry. One instance is the "UI leader" and runs the kanban HTTP server. Others are standbys and take over if the leader dies (detected via health check polling).

## Working in This Codebase

- Run tests: `npm test` (from repo root or individual package)
- Packages use ESM (`"type": "module"`)
- The `.backlog.db` file is part of the repo and should be committed with code changes
- Schemas live in `packages/core/src/schemas.js` — shared across all packages
