# Agent Backlog — API Server (Team Mode)

The optional central API server lets multiple developers share a single backlog.

By default each session uses a local SQLite database (`.backlog.db` in the project root). When `BACKLOG_API_URL` and `BACKLOG_API_KEY` are set, the MCP server connects to a central API server instead.

```
Developer A                Developer B                API Server
┌──────────────┐          ┌──────────────┐          ┌───────────────┐
│ MCP Server   │──HTTP──> │ MCP Server   │──HTTP──> │ api-server.js │
│              │          │              │          │               │
│ Kanban UI    │──proxy─> │ Kanban UI    │──proxy─> │ SQLite per    │
│ :3456        │          │ :3456        │          │ project       │
└──────────────┘          └──────────────┘          └───────────────┘
```

---

## Setup

### 1. Start the server

```bash
node mcp/api-server.js serve
# Listening on http://0.0.0.0:4000
```

### 2. Create a project

```bash
node mcp/api-server.js create-project my-project
# Project "my-project" created.
# API Key: sk-proj-abc123...
# DB: ~/.config/agent-backlog-server/data/my-project.backlog.db
```

### 3. Configure clients

Set `BACKLOG_API_URL` and `BACKLOG_API_KEY` as environment variables on the MCP server process. See [claude-code.md](../claude-code.md) or [copilot-cli.md](../copilot-cli.md) for where to add them.

---

## CLI Commands

| Command | Description |
|---|---|
| `serve` | Start the HTTP server |
| `create-project <slug>` | Generate API key, initialize DB, print key |
| `list-projects` | Show all projects and DB status |
| `delete-project <slug>` | Remove project, API key, and DB |

---

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `BACKLOG_API_PORT` | `4000` | Port the server listens on |
| `BACKLOG_API_DATA_DIR` | `~/.config/agent-backlog-server` | Directory for per-project SQLite databases |

---

## Endpoints

- [Items](./items.md) — list, get, create, update
- [Search](./search.md) — keyword search
- [Checklist](./checklist.md) — add, update, delete checklist items
- [Comments](./comments.md) — append comments
- [Dependencies](./dependencies.md) — add/remove dependency edges
- [Events](./events.md) — SSE live updates
- [Projects](./projects.md) — admin project listing
- [Health](./health.md) — health check

---

## Authentication

All endpoints except `GET /api/health` and `GET /api/projects` require:

```
Authorization: Bearer sk-proj-<key>
```

The key identifies the project — no separate project ID is needed in the URL.

---

## Error responses

| Status | Meaning |
|---|---|
| `400` | Validation error — `{ "error": "field: message" }` |
| `401` | Missing or invalid API key |
| `404` | Item not found |
| `409` | Version conflict — re-fetch and retry |
