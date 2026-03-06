# Agent Backlog — GitHub Copilot CLI Guide

Installation, configuration, hooks, slash commands, and MCP setup for **GitHub Copilot CLI**.

For team/API server setup see [api-server.md](api-server.md).  
For Claude Code setup see [claude-code.md](claude-code.md).

---

## Installation

```bash
copilot plugin marketplace add SoureCode/AgentBacklog
copilot plugin install agent-backlog@sourecode-backlog
cd ~/.copilot/installed-plugins/sourecode-backlog/agent-backlog/mcp
npm install
```

---

## Update

```bash
copilot plugin update agent-backlog@sourecode-backlog
cd ~/.copilot/installed-plugins/sourecode-backlog/agent-backlog/mcp
npm install
```

After updating, **restart your Copilot CLI session** so the new MCP server code is loaded.

---

## Hooks

The plugin registers a `sessionStart` hook (defined in `hooks/copilot-hooks.json`) that auto-installs npm dependencies before the MCP server starts:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "[ -d node_modules ] || npm install --no-audit --no-fund",
        "cwd": "mcp",
        "timeoutSec": 120
      }
    ]
  }
}
```

This runs automatically — no manual setup needed.

---

## MCP Configuration

The MCP server is declared in `copilot-mcp.json` (relative to the plugin root):

```json
{
  "agent-backlog": {
    "command": "node",
    "args": ["${PLUGIN_ROOT}/mcp/server.js"]
  }
}
```

GitHub Copilot CLI resolves `${PLUGIN_ROOT}` to the plugin's installation directory.

### Team mode (remote server)

To connect to a shared API server instead of a local database, add environment variables to your MCP config:

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

See [api-server.md](api-server.md) for how to set up the API server.

---

## Slash Commands

| Command | Description |
|---|---|
| `/backlog [query]` | View the backlog or search by keyword |
| `/backlog-create <description>` | Create a new task with duplicate detection |
| `/backlog-next` | Find and start the next unblocked task |

---

## MCP Tools

| Tool | Purpose | Version required? |
|---|---|---|
| `backlog_list` | List items (optional status filter) | No |
| `backlog_get` | Get a single item with full details | No |
| `backlog_create` | Create a new item | No |
| `backlog_update` | Update title, description, or status | **Yes** |
| `backlog_search` | Search by keyword with relevance ranking | No |
| `checklist_add` | Add a checklist item (supports nesting) | **Yes** |
| `checklist_update` | Toggle checked or change label | **Yes** |
| `checklist_delete` | Remove a checklist item (cascades) | **Yes** |
| `comment_add` | Append a comment | No |
| `dependency_add` | Add a dependency edge (cycle-safe) | **Yes** |
| `dependency_remove` | Remove a dependency edge | **Yes** |

Tools marked **Yes** require passing the item's current `version` number (from `backlog_get`) for optimistic locking. If another agent modified the item since you read it, the operation fails with a conflict error — re-fetch and retry.

---

## Agents

Four specialist agents are bundled and available via the Copilot CLI agent runner:

| Agent | Purpose |
|---|---|
| `backlog-groomer` | Scans for stale tasks, missing details, duplicates, and orphaned dependencies |
| `scope-analyzer` | Analyses a task's impact and suggests checklist items before work starts |
| `task-implementer` | Works through a task's checklist end-to-end |
| `task-planner` | Breaks a feature request into a structured backlog item with checklist and dependencies |

---

## Skills

The **Backlog Manager** skill activates automatically when the conversation mentions tasks, backlog, or what to work on next — no slash command required.

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

Each Copilot CLI session spawns its own MCP server via stdio. On startup, each server:

1. Detects the project root via `git rev-parse --git-common-dir` (worktree-safe)
2. Opens (or creates) a `.backlog.db` SQLite database in the project root
3. Registers the project in a central registry at `~/.config/agent-backlog/projects.json`
4. Participates in leader election — one server starts the kanban UI, others monitor it

```
Copilot Session A         Copilot Session B         Kanban UI
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
