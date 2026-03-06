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

## Team Mode

Team mode connects to a central API server instead of a local SQLite file. See [api-server/README.md](api-server/README.md) to set up the server and obtain an API key.

Once you have a URL and key, set them as environment variables. Copilot CLI inherits environment variables from the shell it was launched in, so adding them to your shell profile is all that is needed.

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) and restart your terminal:

```bash
export BACKLOG_API_URL=http://your-server:4000
export BACKLOG_API_KEY=sk-proj-abc123
```

---

## Hooks

> **Note:** The `sessionStart` hook is currently not working in GitHub Copilot CLI. Run `npm install` manually after install or update (see above).

