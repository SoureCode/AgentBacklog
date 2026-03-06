---
name: backlog-manager
description: >
  Manages agent task backlog items via the agent-backlog MCP server.
  Use this skill whenever the user wants to interact with the project backlog — whether they ask about tasks,
  status, what to work on next, or want to create or update items. Trigger on any of these signals:
  "what's next", "show the backlog", "mark task as done/in-progress", "create a new task",
  "what's blocking", "show open tasks", backlog, task status. Also trigger when the user says they've
  finished a task, or asks for the next thing to work on. When in doubt, use this skill.
---

# Backlog Manager

Agent task backlog managed via the `agent-backlog` MCP server. Works in local mode (SQLite per project) or remote mode (central API server for team sharing). Always use the MCP tools — never read or modify the database directly.

## Data model

Every backlog item has:
- `id` — auto-assigned integer (the sole identifier; use it in all MCP calls)
- `title` — plain descriptive title
- `status` — `open` | `in_progress` | `done`
- `description` — full markdown content (goal, implementation notes, acceptance criteria)
- `version` — integer for optimistic locking (starts at 1, incremented on every mutation)
- `checklist` — structured checklist items managed via checklist tools
- `dependencies` — dependency edges managed via dependency tools
- `comments` — append-only thread managed via comment tools

## Optimistic locking (CRITICAL)

Multiple agents may work on the same backlog concurrently. To prevent lost updates, **every mutating tool** (except `comment_add`) requires the item's current `version` number.

1. Call `backlog_get` — note the `version` field in the response
2. Pass that `version` to any update tool (`backlog_update`, `checklist_add`, etc.)
3. If another agent modified the item since your read, the tool returns a **CONFLICT error** with the current item state
4. On conflict: **re-fetch** with `backlog_get`, review the changes, then retry with the new version

Rules:
- **Always pass `version`** to mutating tools (except `comment_add`)
- **After each successful mutation**, use the returned `item_version` (or re-fetch) for subsequent calls
- **On CONFLICT**, do not retry blindly — read the updated item first, your changes may already be done or the context may have changed
- `comment_add` is exempt from version checks because comments are append-only

## MCP tools reference

| Tool | Params | Version required? |
|---|---|---|
| `backlog_list` | optional `status` filter | No |
| `backlog_get` | `id` | No |
| `backlog_create` | `title`, `description`, `status` | No (new item) |
| `backlog_update` | `id`, `version`, optional `title`/`description`/`status` | **Yes** |
| `checklist_add` | `item_id`, `version`, `label`, optional `parent_id` | **Yes** |
| `checklist_update` | `item_id`, `version`, `id`, optional `label`/`checked` | **Yes** |
| `checklist_delete` | `item_id`, `version`, `id` | **Yes** |
| `comment_add` | `item_id`, `body` | No |
| `dependency_add` | `item_id`, `version`, `depends_on_id` | **Yes** |
| `dependency_remove` | `item_id`, `version`, `depends_on_id` | **Yes** |
| `backlog_search` | `query`, optional `status` | No |

## Task description format

The `description` field holds only narrative content. Checklist steps go in the `checklist` array; dependencies go in the `dependencies` edges — never duplicate them in the description.

```markdown
## Goal

What needs to be built and why — one or two paragraphs. Include enough context for an implementer
to understand scope (e.g. which component, rough area of the codebase).

## Notes

- Architectural decisions already made, constraints, gotchas
- Relevant interface or service names
- Anything an implementer needs to know before starting

## Acceptance

- Concrete, verifiable criterion
- Another criterion (tests pass, endpoint returns X, etc.)
```

Rules:
- `## Notes` is omitted if there is nothing meaningful to say before work starts
- `## Acceptance` is a list of verifiable criteria, not freeform prose
- Do not embed checklist steps or dependency IDs in the description
- Comments go through `comment_add`, never in the description

## Common operations

### View the backlog

1. Call `backlog_list` (no filter)
2. Group by status: `in_progress` first, then `open`, then `done`
3. Display as a table: ID | Title | Status

### Read a specific task

1. Call `backlog_get` with the item id

### Update task status

1. Call `backlog_get` to get the current `version`
2. Call `backlog_update` with the new `status` and the `version`
3. Valid transitions: `open` -> `in_progress` -> `done` (reversal also valid)
4. For `done`, ensure all checklist items are checked via `checklist_update` first

### Close a completed task

When a task reaches `done`:

1. Call `backlog_get` to get the latest version
2. Call `backlog_update` with `status: "done"` and `version`
3. Call `comment_add` with a note summarising what was done and any relevant outcome

**Always do these steps after finishing implementation** — never leave a completed task as `in_progress`.

### Create a new task

1. Call `backlog_create` with:
   - `title`: plain descriptive title
   - `description`: formatted per task description format above
   - `status`: `"open"`
2. Note the returned `version` (will be 1)
3. Add checklist items via `checklist_add` (pass `version`, use returned `item_version` for next call)
4. Add dependencies via `dependency_add` (same version chaining)

### Find what to work on next

1. Call `backlog_list` to get all items
2. Show any `in_progress` tasks first — resume these
3. Among `open` tasks, show those where all dependencies have `status: done`
4. If nothing is ready, show which dependencies are still blocking

Present:
- In-progress tasks (resume first)
- First ready-to-start task with its goal and checklist
- Blocked tasks and what's blocking them

### Start working on a task

Before beginning any implementation work on a backlog item:

1. **Always fetch the item first** — call `backlog_get` to get the latest state and `version`. Another agent or a human may have updated the description, checklist, comments, or status since you last saw it. Read all comments carefully — they may contain decisions, clarifications, or instructions that change how you should proceed.
2. Call `backlog_update` with `status: "in_progress"` and `version`
3. Work through the checklist **one item at a time, top to bottom**:
   - Read the checklist item
   - Do the work for that item
   - Call `checklist_update` with `checked: true` — pass the current `version` (use `item_version` from the last successful mutation, or re-fetch)
   - For parent items with children: complete all children first, then check the parent
4. Never batch-check multiple items at the end — the kanban UI shows live progress, so each check should reflect real completed work
5. When all checklist items are done: call `backlog_update` with `status: "done"`, then call `comment_add` summarising what was done

### Handle version conflicts

If a tool returns a CONFLICT error:

1. The error message tells you the item was modified by another agent
2. Call `backlog_get` to fetch the latest state
3. Review what changed — the other agent may have:
   - Checked off checklist items you were about to check
   - Changed the status or description
   - Added comments with new instructions
4. Adjust your plan based on the new state
5. Retry your operation with the new `version`

### Search the backlog

1. Call `backlog_search` with a `query` string (case-insensitive substring match on title and description)
2. Optionally pass `status` to narrow results to `open`, `in_progress`, or `done`
3. Use this instead of `backlog_list` when the user is looking for a specific topic or keyword

### Check what's blocking a task

1. Call `backlog_get` on the task
2. For each id in `dependencies`, call `backlog_get` to check its status
3. Report incomplete dependencies

## Important

- Always use MCP tools — never read or modify the database directly
- Always pass `version` to mutating tools (except `comment_add`)
- On CONFLICT errors: re-fetch, review, then retry
- Never delete items — they are preserved for history
- When closing a done task: mark `done` and add a summary comment
