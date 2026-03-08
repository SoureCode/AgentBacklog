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

> **Note:** Copilot CLI does **not** forward the parent shell's environment variables to the MCP server subprocess. Use config files instead (described below).

### Global config — all projects

Create `~/.config/agent-backlog/config.json`:

```json
{
  "BACKLOG_API_URL": "http://your-server:4000",
  "BACKLOG_API_KEY": "sk-proj-abc123"
}
```

### Per-repo config — one project

Create `.backlog.json` in the project root for shared team config (safe to commit — keep secrets out):

```json
{
  "BACKLOG_API_URL": "http://your-server:4000"
}
```

Create `.backlog.local.json` for personal secrets (add to `.gitignore`):

```json
{
  "BACKLOG_API_KEY": "sk-proj-abc123"
}
```

Per-repo local overrides per-repo which overrides global. Shell environment variables always take highest precedence.

---

## Configuration reference

See [configuration.md](configuration.md) for all environment variables and config file locations.

---

## Hooks

> **Note:** The `sessionStart` hook is currently not working in GitHub Copilot CLI. Run `npm install` manually after install or update (see above).

