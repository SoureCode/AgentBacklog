# Agent Backlog

A Claude Code plugin for managing agent task backlogs with a live kanban UI.

## Structure

```
agent-backlog/
├── .claude-plugin/
│   └── plugin.json           # Plugin metadata
├── .mcp.json                 # MCP server configuration
├── agents/
│   └── task-planner.md       # Codebase-aware task planning agent
├── commands/
│   ├── backlog.md            # /backlog - view or search the backlog
│   ├── backlog-create.md     # /backlog-create - create a new task
│   ├── backlog-next.md       # /backlog-next - find what to work on next
│   └── backlog-done.md       # /backlog-done - mark a task as complete
├── skills/
│   └── backlog-manager/
│       └── SKILL.md          # Auto-triggered backlog management skill
└── mcp/
    ├── server.js             # MCP server + HTTP kanban UI
    ├── kanban.html           # Kanban board UI
    └── package.json
```

## Features

- **MCP Tools**: Create, update, search, and organize backlog items with checklists, dependencies, and comments
- **Kanban UI**: Live-updating board at `http://localhost:3456` (configurable via `BACKLOG_UI_PORT`)
- **Slash Commands**: `/backlog`, `/backlog-create`, `/backlog-next`, `/backlog-done`
- **Agent**: Task planner that explores the codebase to create well-structured tasks
- **Skill**: Automatically activates when discussing tasks, backlog, or what to work on next

## MCP Tools

| Tool | Purpose |
|---|---|
| `backlog_list` | List items (optional status filter) |
| `backlog_get` | Get a single item by id |
| `backlog_create` | Create a new item |
| `backlog_update` | Update title, description, or status |
| `backlog_search` | Search by keyword |
| `checklist_add` | Add a checklist item |
| `checklist_update` | Toggle checked or change label |
| `checklist_delete` | Remove a checklist item |
| `comment_add` | Append a comment |
| `dependency_add` | Add a dependency edge |
| `dependency_remove` | Remove a dependency edge |

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `BACKLOG_FILE` | `./agent-backlog.json` | Path to the backlog data file |
| `BACKLOG_UI_PORT` | `3456` | Port for the kanban web UI |

## Installation

```
/plugin install /path/to/AgentBacklog
```
