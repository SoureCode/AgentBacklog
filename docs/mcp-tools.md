# Agent Backlog — MCP Tools

Available in both **Claude Code** and **GitHub Copilot CLI**.

For client setup see [claude-code.md](claude-code.md) or [copilot-cli.md](copilot-cli.md).

---

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
