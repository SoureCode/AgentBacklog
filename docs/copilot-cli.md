# Agent Backlog — GitHub Copilot CLI Guide

Installation and hooks for **GitHub Copilot CLI**.

For team/API server setup see [api-server/README.md](api-server/README.md).  
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

## Uninstall

```bash
copilot plugin uninstall agent-backlog@sourecode-backlog
```

To also remove leftover data:

```bash
# Remove the project registry
rm -r ~/.config/agent-backlog

# Remove the backlog database from each project (run per project)
rm .backlog.db
```

---

## Hooks

> **Note:** The `sessionStart` hook is currently not working in GitHub Copilot CLI. Run `npm install` manually after install or update (see above).

