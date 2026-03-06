# Agent Backlog

A Claude Code plugin for managing agent task backlogs with a kanban UI.

## Features

- **11 MCP Tools** — CRUD, checklists, dependencies, comments, and search
- **Optimistic Locking** — Version-based conflict detection for concurrent agent access
- **Project Aware** — Auto-detects git root (worktree-safe), stores `.backlog.db` per project
- **Team Mode** — Optional central API server with per-project API keys for shared backlogs
- **Kanban UI** — Central web UI at `http://localhost:3456` with project selector and live updates via SSE
- **Leader Election** — MCP server instances coordinate to run a single UI; automatic failover on crash
- **Slash Commands** — `/backlog`, `/backlog-create`, `/backlog-next`
- **4 Agents** — Task Planner, Backlog Groomer, Task Implementer, and Scope Analyzer
- **Backlog Manager Skill** — Automatically activates when discussing tasks or backlog

## Installation

### From the marketplace

Add the marketplace and install the plugin:

```bash
claude plugin marketplace add SoureCode/AgentBacklog
claude plugin install agent-backlog@sourecode-backlog
```

To install for a specific project only:

```bash
claude plugin marketplace add SoureCode/AgentBacklog --scope project
claude plugin install agent-backlog@sourecode-backlog --scope project
```

npm dependencies (`better-sqlite3`, `@modelcontextprotocol/sdk`) are installed automatically on first session start via a `SessionStart` hook.

### From a local clone

```bash
git clone https://github.com/SoureCode/AgentBacklog.git
cd AgentBacklog
npm install --prefix mcp
claude plugin marketplace add .
claude plugin install agent-backlog@sourecode-backlog
```

### Recommend to your team

Add to your project's `.claude/settings.json` so team members are prompted to install:

```json
{
  "extraKnownMarketplaces": {
    "sourecode-backlog": {
      "source": {
        "source": "github",
        "repo": "SoureCode/AgentBacklog"
      }
    }
  },
  "enabledPlugins": {
    "agent-backlog@sourecode-backlog": true
  }
}
```

### Update

```bash
claude plugin update agent-backlog@sourecode-backlog
```

### Uninstall

```bash
claude plugin uninstall agent-backlog@sourecode-backlog
```

## How it works

### Local mode (default)

Each Claude Code session spawns its own MCP server via stdio. On startup, each server:

1. Detects the project root via `git rev-parse --git-common-dir` (worktree-safe)
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

### Remote mode (team)

When `BACKLOG_API_URL` and `BACKLOG_API_KEY` are set, the MCP server connects to a central API server instead of using a local SQLite database. Multiple developers share the same backlog.

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

## API Server Setup (Team Mode)

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

Add to your `.mcp.json` or set environment variables:

```json
{
  "mcpServers": {
    "agent-backlog": {
      "command": "node",
      "args": ["mcp/server.js"],
      "env": {
        "BACKLOG_API_URL": "http://your-server:4000",
        "BACKLOG_API_KEY": "sk-proj-abc123..."
      }
    }
  }
}
```

### API Server CLI Commands

| Command | Description |
|---|---|
| `serve` | Start the HTTP server (default) |
| `create-project <slug>` | Generate API key, initialize DB, print key |
| `list-projects` | Show all projects |
| `delete-project <slug>` | Remove project and DB |

### API Server REST Endpoints

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
| `BACKLOG_FILE` | `<git-root>/.backlog.db` | Path to the SQLite database (local mode) |
| `BACKLOG_UI_PORT` | `3456` | Port for the kanban UI |
| `BACKLOG_API_URL` | — | API server URL (enables remote mode) |
| `BACKLOG_API_KEY` | — | API key for the project (enables remote mode) |
| `BACKLOG_API_PORT` | `4000` | Port for the API server |
| `BACKLOG_API_DATA_DIR` | `~/.config/agent-backlog-server` | API server data directory |

## Project Structure

```
AgentBacklog/
├── .claude-plugin/
│   ├── plugin.json           # Plugin metadata
│   └── marketplace.json      # Marketplace manifest
├── .mcp.json                 # MCP server configuration
├── hooks/
│   └── hooks.json            # SessionStart hook for npm install
├── agents/
│   ├── backlog-groomer.md    # Backlog health and maintenance agent
│   ├── scope-analyzer.md    # Pre-work impact analysis agent
│   ├── task-implementer.md  # Task execution agent
│   └── task-planner.md      # Codebase-aware task planning agent
├── commands/
│   ├── backlog.md            # /backlog command
│   ├── backlog-create.md     # /backlog-create command
│   └── backlog-next.md       # /backlog-next command
├── skills/
│   └── backlog-manager/
│       └── SKILL.md          # Auto-triggered backlog skill
└── mcp/
    ├── db.js                 # SQLite database, registry, leader election
    ├── server.js             # MCP server (stdio)
    ├── ui.js                 # Kanban UI server (HTTP)
    ├── api-server.js         # Central API server for team mode
    ├── store.js              # Store factory (local vs remote)
    ├── store-local.js        # LocalStore — SQLite via db.js
    ├── store-remote.js       # RemoteStore — HTTP client for API server
    ├── kanban.html           # Kanban board SPA
    └── package.json
```
