# Agent Backlog

A Claude Code plugin for managing agent task backlogs with a kanban UI.

## Features

- **11 MCP Tools** — CRUD, checklists, dependencies, comments, and search
- **Optimistic Locking** — Version-based conflict detection for concurrent agent access
- **Project Aware** — Auto-detects git root, stores `.backlog.db` per project
- **Kanban UI** — Central web UI at `http://localhost:3456` with project selector and live updates via SSE
- **Leader Election** — MCP server instances coordinate to run a single UI; automatic failover on crash
- **Slash Commands** — `/backlog`, `/backlog-create`, `/backlog-next`, `/backlog-done`
- **Task Planner Agent** — Explores the codebase to create structured backlog items
- **Backlog Manager Skill** — Automatically activates when discussing tasks or backlog

## Installation

### From GitHub

```bash
claude plugin install --git https://github.com/SoureCode/AgentBacklog.git
```

### From a local clone

```bash
git clone https://github.com/SoureCode/AgentBacklog.git
cd AgentBacklog
npm install --prefix mcp
claude plugin install .
```

## How it works

Each Claude Code session spawns its own MCP server (`mcp/server.js`) via stdio. On startup, each server:

1. Detects the project root via `git rev-parse --show-toplevel`
2. Opens (or creates) a `.backlog.db` SQLite database in the project root
3. Registers the project in a central registry at `~/.config/agent-backlog/projects.json`
4. Participates in leader election — one server starts the kanban UI, others monitor it

```
Claude Session A          Claude Session B          Kanban UI
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

## Kanban UI

The UI starts automatically via leader election — no manual setup needed. To run it standalone:

```bash
node mcp/ui.js
```

Open `http://localhost:3456` and select a project from the dropdown. The board updates live via Server-Sent Events.

## Slash Commands

| Command | Description |
|---|---|
| `/backlog [query]` | View the backlog or search by keyword |
| `/backlog-create <description>` | Create a new task with duplicate detection |
| `/backlog-next` | Find and start the next unblocked task |
| `/backlog-done <id>` | Mark a task as complete |

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

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `BACKLOG_FILE` | `<git-root>/.backlog.db` | Path to the SQLite database |
| `BACKLOG_UI_PORT` | `3456` | Port for the kanban UI |

## Project Structure

```
AgentBacklog/
├── .claude-plugin/
│   └── plugin.json           # Plugin metadata
├── .mcp.json                 # MCP server configuration
├── agents/
│   └── task-planner.md       # Codebase-aware task planning agent
├── commands/
│   ├── backlog.md            # /backlog command
│   ├── backlog-create.md     # /backlog-create command
│   ├── backlog-next.md       # /backlog-next command
│   └── backlog-done.md       # /backlog-done command
├── skills/
│   └── backlog-manager/
│       └── SKILL.md          # Auto-triggered backlog skill
└── mcp/
    ├── db.js                 # SQLite database, registry, leader election
    ├── server.js             # MCP server (stdio)
    ├── ui.js                 # Kanban UI server (HTTP)
    ├── kanban.html           # Kanban board SPA
    └── package.json
```
