# Agent Backlog — Configuration Reference

All MCP server environment variables. Can be set in any config file or as shell environment variables.

## Config file locations

| File | Scope | Notes |
|---|---|---|
| `~/.config/agent-backlog/config.json` | All projects, all users | Global fallback |
| `{project_root}/.backlog.json` | One project | Safe to commit (keep secrets out) |
| `{project_root}/.backlog.local.json` | One project | Add to `.gitignore` — for secrets |

**Precedence (highest → lowest):** shell env vars → `.backlog.local.json` → `.backlog.json` → `config.json`

Any string key/value pair is valid in the JSON files. Example `.backlog.json`:

```json
{
  "BACKLOG_API_URL": "http://your-server:4000"
}
```

Example `.backlog.local.json`:

```json
{
  "BACKLOG_API_KEY": "sk-proj-abc123"
}
```

---

## MCP server variables

| Variable | Default | Description |
|---|---|---|
| `BACKLOG_API_URL` | — | Remote API server URL. Enables team mode when set together with `BACKLOG_API_KEY` |
| `BACKLOG_API_KEY` | — | Remote API server key |
| `BACKLOG_PROJECT_ROOT` | auto-detected | Override the project root directory |
| `BACKLOG_FILE` | `{project_root}/.backlog.db` | Override the local SQLite database path |
| `BACKLOG_UI_PORT` | `3456` | Port for the kanban UI |
| `BACKLOG_LOG_DIR` | `~/.config/agent-backlog/logs` | Log file directory |
| `LOG_LEVEL` | `info` | Log level: `trace`, `debug`, `info`, `warn`, `error` |
| `BACKLOG_REQUEST_TIMEOUT_MS` | `10000` | Remote API request timeout in milliseconds |

## API server variables

These apply to the separately-run `api-server.js` process only.

| Variable | Default | Description |
|---|---|---|
| `BACKLOG_API_PORT` | `4000` | Port the API server listens on |
| `BACKLOG_API_DATA_DIR` | `~/.config/agent-backlog-server` | Directory for per-project SQLite databases |
