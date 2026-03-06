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
claude plugin update agent-backlog@sourecode-backlog
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
