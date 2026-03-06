# Agent Backlog

A Claude Code plugin for managing agent task backlogs with a central kanban UI.

## Architecture

```
MCP Server (per session, stdio)         Central UI (one instance, HTTP)
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  node mcp/server.js         │         │  node mcp/ui.js              │
│  - Pure MCP tools (stdio)   │         │  - Project picker            │
│  - Opens project's .backlog │─write──>│  - Kanban board per project  │
│  - Registers in registry    │  .db    │  - Reads registry to find    │
│  - One per Claude session   │         │    all project databases     │
└─────────────────────────────┘         │  - Single port, all projects │
                                        └──────────────────────────────┘
                                          reads ~/.config/agent-backlog/
                                                  projects.json
```

- **MCP server** (`server.js`): Spawned by Claude Code per session via stdio. Opens the project's `.backlog.db` and registers its path in `~/.config/agent-backlog/projects.json`.
- **UI server** (`ui.js`): Run once manually. Reads the registry to discover all projects. Opens each project's SQLite database directly. Serves a single kanban UI with a project selector dropdown.

## Plugin Structure

```
agent-backlog/
├── .claude-plugin/
│   └── plugin.json           # Plugin metadata
├── .mcp.json                 # MCP server configuration
├── agents/
│   └── task-planner.md       # Codebase-aware task planning agent
├── commands/
│   ├── backlog.md            # /backlog - view or search
│   ├── backlog-create.md     # /backlog-create - create a task
│   ├── backlog-next.md       # /backlog-next - find next task
│   └── backlog-done.md       # /backlog-done - complete a task
├── skills/
│   └── backlog-manager/
│       └── SKILL.md          # Auto-triggered skill
└── mcp/
    ├── db.js                 # Shared database module + registry
    ├── server.js             # MCP server (stdio, no HTTP)
    ├── ui.js                 # Central UI server (HTTP)
    ├── kanban.html           # Kanban board with project picker
    └── package.json
```

## Features

- **MCP Tools**: 11 tools for CRUD, checklists, dependencies, comments, and search
- **Optimistic Locking**: Version-based conflict detection for concurrent agent access
- **Project Aware**: Auto-detects git root, stores `.backlog.db` per project
- **Central UI**: Single kanban server at `http://localhost:3456` with project selector
- **Slash Commands**: `/backlog`, `/backlog-create`, `/backlog-next`, `/backlog-done`
- **Agent**: Task planner that explores the codebase to create structured tasks
- **Skill**: Automatically activates when discussing tasks or backlog

## Usage

### Start the UI (once)

```bash
node mcp/ui.js
# or: npx agent-backlog-ui
```

Open `http://localhost:3456` — select a project from the dropdown.

### Install the plugin

```
/plugin install /path/to/AgentBacklog
```

The MCP server starts automatically per Claude Code session. It registers the project in the central registry so the UI can discover it.

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `BACKLOG_FILE` | `<git-root>/.backlog.db` | Path to the SQLite database |
| `BACKLOG_UI_PORT` | `3456` | Port for the central kanban UI |

## MCP Tools

| Tool | Purpose | Version required? |
|---|---|---|
| `backlog_list` | List items (optional status filter) | No |
| `backlog_get` | Get a single item by id | No |
| `backlog_create` | Create a new item | No |
| `backlog_update` | Update title, description, or status | **Yes** |
| `backlog_search` | Search by keyword | No |
| `checklist_add` | Add a checklist item | **Yes** |
| `checklist_update` | Toggle checked or change label | **Yes** |
| `checklist_delete` | Remove a checklist item | **Yes** |
| `comment_add` | Append a comment | No |
| `dependency_add` | Add a dependency edge | **Yes** |
| `dependency_remove` | Remove a dependency edge | **Yes** |
