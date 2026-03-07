# Agent Backlog — Claude Code Guide

Installation and hooks for **Claude Code**.

For team/API server setup see [api-server/README.md](api-server/README.md).  
For GitHub Copilot CLI setup see [copilot-cli.md](copilot-cli.md).

---

## Installation

### From the marketplace

```bash
claude plugin marketplace add SoureCode/AgentBacklog
claude plugin install agent-backlog@sourecode-backlog
```

To install for a specific project only:

```bash
claude plugin marketplace add SoureCode/AgentBacklog --scope project
claude plugin install agent-backlog@sourecode-backlog --scope project
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
claude plugin uninstall agent-backlog@sourecode-backlog
claude plugin marketplace remove sourecode-backlog
claude plugin marketplace add SoureCode/AgentBacklog
claude plugin install agent-backlog@sourecode-backlog
```

After updating, **start a new Claude Code session** so the new MCP server code is loaded. The `SessionStart` hook will re-run `npm install` automatically if new dependencies were added.

### Uninstall

```bash
claude plugin uninstall agent-backlog@sourecode-backlog
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

Once you have a URL and key, configure them as environment variables on the MCP server process.

### Option A — System environment variables (simplest)

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) and restart your terminal:

```bash
export BACKLOG_API_URL=http://your-server:4000
export BACKLOG_API_KEY=sk-proj-abc123
```

Claude Code inherits these when it spawns the MCP server process.

### Option B — Per-user MCP config

Add an `env` block for the plugin's MCP server in `~/.claude.json`. This file is merged with the plugin's config, so you only need the env overrides — not the full command/args:

```json
{
  "mcpServers": {
    "agent-backlog": {
      "env": {
        "BACKLOG_API_URL": "http://your-server:4000",
        "BACKLOG_API_KEY": "sk-proj-abc123"
      }
    }
  }
}
```

This applies to every project for that user.

### Option C — Per-project config (recommended for teams)

Each project on the API server has its own API key, so different repos can point at different backlogs. Split the config across two files:

**`.claude/settings.json`** (commit this — safe to share):

```json
{
  "mcpServers": {
    "agent-backlog": {
      "env": {
        "BACKLOG_API_URL": "http://your-server:4000"
      }
    }
  }
}
```

**`.claude/settings.local.json`** (do not commit — add to `.gitignore`):

```json
{
  "mcpServers": {
    "agent-backlog": {
      "env": {
        "BACKLOG_API_KEY": "sk-proj-abc123"
      }
    }
  }
}
```

Claude Code merges both files, so the MCP server receives both variables. The URL is safe to commit; the key stays out of version control. Each team member adds only their own `settings.local.json`.

### Option D — Per-project backlog config files

Alternatively, use backlog-native config files in the project root (these work for both Claude Code and Copilot CLI):

**`.backlog.json`** (commit this — safe to share):

```json
{
  "BACKLOG_API_URL": "http://your-server:4000"
}
```

**`.backlog.local.json`** (do not commit — add to `.gitignore`):

```json
{
  "BACKLOG_API_KEY": "sk-proj-abc123"
}
```

---

## Configuration reference

See [configuration.md](configuration.md) for all environment variables and config file locations.
