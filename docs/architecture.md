# Agent Backlog — Architecture & Configuration

Applies to both **Claude Code** and **GitHub Copilot CLI** in local mode.

For team/API server setup see [api-server/README.md](../api-server/README.md).  
For client setup see [claude-code.md](claude-code.md) or [copilot-cli.md](copilot-cli.md).

---

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `BACKLOG_FILE` | `<git-root>/.backlog.db` | Path to the SQLite database (local mode) |
| `BACKLOG_UI_PORT` | `3456` | Port for the kanban UI |
| `BACKLOG_API_URL` | — | API server URL (enables remote/team mode) |
| `BACKLOG_API_KEY` | — | API key for the project (enables remote/team mode) |

---

## How it works (local mode)

Each agent session spawns its own MCP server via stdio. On startup, each server:

1. Detects the project root via `git rev-parse --git-common-dir` (worktree-safe)
2. Opens (or creates) a `.backlog.db` SQLite database in the project root
3. Registers the project in a central registry at `~/.config/agent-backlog/projects.json`
4. Participates in leader election — one server starts the kanban UI, others monitor it

```
Session A                 Session B                 Kanban UI
┌──────────────┐          ┌──────────────┐          ┌───────────────┐
│ MCP Server   │─write──> │ MCP Server   │─write──> │ http://       │
│ (stdio)      │  .db     │ (stdio)      │  .db     │ localhost:3456│
│ UI leader    │──runs───>│ standby      │──takes──>│ project picker│
└──────────────┘          └──────────────┘  over    │ kanban board  │
                                           if dead  └───────────────┘
                                                      reads registry
                                                      opens DBs
```

If the UI leader crashes or its session ends, a standby server detects this via HTTP health checks and takes over automatically.

The kanban UI starts automatically — no manual setup needed. To run it standalone:

```bash
node mcp/ui.js
```

Open `http://localhost:3456` and select a project from the dropdown. The board updates live via Server-Sent Events.
