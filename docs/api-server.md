# Agent Backlog — API Server (Team Mode)

This guide covers the optional central API server that enables multiple developers to share a single backlog.

For client-specific setup see [claude-code.md](claude-code.md) or [copilot-cli.md](copilot-cli.md).

---

## Overview

By default each session uses a local SQLite database (`.backlog.db` in the project root). When `BACKLOG_API_URL` and `BACKLOG_API_KEY` are set, the MCP server connects to a central API server instead.

```
Developer A                Developer B                API Server
┌──────────────┐          ┌──────────────┐          ┌───────────────┐
│ MCP Server   │──HTTP──> │ MCP Server   │──HTTP──> │ agent-backlog │
│ (stdio)      │          │ (stdio)      │          │ -api serve    │
│              │          │              │          │               │
│ Kanban UI    │──proxy─> │ Kanban UI    │──proxy─> │ SQLite per    │
│ :3456        │          │ :3456        │          │ project       │
└──────────────┘          └──────────────┘          └───────────────┘
```

---

## Setup

### 1. Start the API server

```bash
node mcp/api-server.js serve
# Listens on http://0.0.0.0:4000 by default
```

### 2. Create a project

```bash
node mcp/api-server.js create-project my-project
# Project "my-project" created.
# API Key: sk-proj-abc123...
```

### 3. Configure clients

Add environment variables to your MCP server config. The exact file depends on your client:

**Claude Code** (`.mcp.json` or project settings):

```json
{
  "mcpServers": {
    "agent-backlog": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.js"],
      "env": {
        "BACKLOG_API_URL": "http://your-server:4000",
        "BACKLOG_API_KEY": "sk-proj-abc123..."
      }
    }
  }
}
```

**GitHub Copilot CLI** (MCP config):

```json
{
  "mcpServers": {
    "agent-backlog": {
      "command": "node",
      "args": ["${PLUGIN_ROOT}/mcp/server.js"],
      "env": {
        "BACKLOG_API_URL": "http://your-server:4000",
        "BACKLOG_API_KEY": "sk-proj-abc123..."
      }
    }
  }
}
```

---

## CLI Commands

| Command | Description |
|---|---|
| `serve` | Start the HTTP server |
| `create-project <slug>` | Generate API key, initialize DB, print key |
| `list-projects` | Show all projects |
| `delete-project <slug>` | Remove project and DB |

---

## REST Endpoints

All endpoints require `Authorization: Bearer <key>` except `/api/health` and `/api/projects`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/projects` | List all projects with item counts |
| GET | `/api/items?status=` | List items |
| GET | `/api/items/:id` | Get item details |
| POST | `/api/items` | Create item |
| PATCH | `/api/items/:id` | Update item |
| GET | `/api/search?q=&status=` | Search items |
| POST | `/api/items/:id/checklist` | Add checklist item |
| PATCH | `/api/items/:id/checklist/:cid` | Update checklist item |
| DELETE | `/api/items/:id/checklist/:cid` | Delete checklist item |
| POST | `/api/items/:id/comments` | Add comment |
| POST | `/api/items/:id/dependencies` | Add dependency |
| DELETE | `/api/items/:id/dependencies/:did` | Remove dependency |
| GET | `/api/events` | SSE live updates |

---

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `BACKLOG_API_PORT` | `4000` | Port for the API server |
| `BACKLOG_API_DATA_DIR` | `~/.config/agent-backlog-server` | Directory where per-project SQLite databases are stored |
