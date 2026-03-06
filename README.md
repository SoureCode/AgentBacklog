# Agent Backlog

A plugin for Claude Code and GitHub Copilot CLI for managing agent task backlogs with a kanban UI.

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

## Getting Started

Choose the guide for your client:

- **[Claude Code →](docs/claude-code.md)** — installation, hooks, MCP config
- **[GitHub Copilot CLI →](docs/copilot-cli.md)** — installation, hooks, MCP config
- **[API Server (Team Mode) →](docs/api-server/README.md)** — central server setup, REST endpoints, CLI commands

## Reference

- **[MCP Tools →](docs/mcp-tools.md)** — full tool reference with version/locking notes
- **[Architecture & Configuration →](docs/architecture.md)** — how local mode works, env vars, kanban UI

## Project Structure

```
AgentBacklog/
├── docs/
│   ├── claude-code.md                # Claude Code setup guide
│   ├── copilot-cli.md                # GitHub Copilot CLI setup guide
│   ├── api-server/                   # Team mode / API server guide
│   │   ├── README.md                 #   Overview, setup, CLI commands, config
│   │   ├── items.md                  #   List, get, create, update items
│   │   ├── search.md                 #   Keyword search
│   │   ├── checklist.md              #   Checklist add/update/delete
│   │   ├── comments.md               #   Append comments
│   │   ├── dependencies.md           #   Add/remove dependency edges
│   │   ├── events.md                 #   SSE live updates
│   │   ├── projects.md               #   Admin project listing
│   │   └── health.md                 #   Health check
│   ├── mcp-tools.md                  # MCP tools reference
│   └── architecture.md               # Local mode architecture & configuration
├── .claude-plugin/
│   └── marketplace.json              # Marketplace manifest
└── plugins/
    └── agent-backlog/                # Plugin root
        ├── plugin.json               # Copilot CLI manifest
        ├── .claude-plugin/
        │   └── plugin.json           # Claude Code manifest
        ├── .mcp.json                 # MCP server config (Claude Code)
        ├── copilot-mcp.json          # MCP server config (Copilot CLI)
        ├── hooks/
        │   ├── hooks.json            # SessionStart hook (Claude Code)
        │   └── copilot-hooks.json    # sessionStart hook (Copilot CLI)
        ├── agents/
        │   ├── backlog-groomer.md    # Backlog health and maintenance agent
        │   ├── scope-analyzer.md     # Pre-work impact analysis agent
        │   ├── task-implementer.md   # Task execution agent
        │   └── task-planner.md       # Codebase-aware task planning agent
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

## development

Switch to the local plugin:

```
copilot plugin uninstall agent-backlog@sourecode-backlog
copilot plugin install ./plugins/agent-backlog/
pushd ~/.copilot/installed-plugins/_direct/agent-backlog/mcp && npm install && popd
```

Update plugin:

```
copilot plugin uninstall agent-backlog
copilot plugin install ./plugins/agent-backlog/
pushd ~/.copilot/installed-plugins/_direct/agent-backlog/mcp && npm install && popd
```