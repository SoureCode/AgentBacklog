---
name: backlog-manager
description: >
  Manages agent task backlog items via the agent-backlog MCP server (JSON store, not markdown files).
  Use this skill whenever the user wants to interact with the project backlog — whether they ask about tasks,
  status, what to work on next, or want to create or update items. Trigger on any of these signals:
  "what's next", "show the backlog", "mark task as done/in-progress", "create a new task",
  "what's blocking", "show open tasks", backlog, task status. Also trigger when the user says they've
  finished a task, or asks for the next thing to work on. When in doubt, use this skill.
---

# Backlog Manager

Agent task backlog managed via the `agent-backlog` MCP server. Always use the MCP tools.

## Data model

Every backlog item has:
- `id` — auto-assigned integer (the sole identifier; use it in all MCP calls)
- `title` — plain descriptive title
- `status` — `open` | `in_progress` | `done`
- `description` — full markdown content (goal, implementation notes, acceptance criteria)
- `checklist` — structured checklist items managed via checklist tools
- `dependencies` — dependency edges managed via dependency tools

## MCP tools reference

| Tool | Purpose |
|---|---|
| `backlog_list` | List all items (optional `status` filter: `open`, `in_progress`, `done`) |
| `backlog_get` | Get a single item by id |
| `backlog_create` | Create item (`title`, `description`, `status`) |
| `backlog_update` | Update `title`, `description`, or `status` by id |
| `checklist_add` | Add checklist item (`item_id`, `label`, optional `parent_id` for nesting) |
| `checklist_update` | Toggle `checked` or change `label` (`item_id`, `id`, optional `label`/`checked`) |
| `checklist_delete` | Remove a checklist item and its children |
| `comment_add` | Append a permanent comment to an item (`item_id`, `body`) |
| `dependency_add` | Mark that `item_id` depends on `depends_on_id` |
| `dependency_remove` | Remove a dependency edge |
| `backlog_search` | Search by keyword across title and description (optional `status` filter) |

## Task description format

The `description` field holds only narrative content. Checklist steps go in the `checklist` array; dependencies go in the `dependencies` edges — never duplicate them in the description.

```markdown
## Goal

What needs to be built and why — one or two paragraphs. Include enough context for an implementer
to understand scope (e.g. which bundle or component, rough area of the codebase).

## Notes

- Architectural decisions already made, constraints, gotchas
- RFC references, relevant interface or service names
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

1. Call `backlog_update` with the new `status`
2. Valid transitions: `open` → `in_progress` → `done` (reversal also valid)
3. For `done`, ensure all checklist items are checked via `checklist_update`

### Close a completed task

When a task reaches `done`:

1. **Write documentation** into the package's `docs/` directory (see bundle docs rules in CLAUDE.md)
2. Call `backlog_update` with `status: "done"`
3. Call `comment_add` with a note summarising what was done and any relevant outcome

**Always do steps 2 and 3 after finishing implementation** — never leave a completed task as `in_progress`.

### Create a new task

1. Call `backlog_create` with:
   - `title`: plain descriptive title
   - `description`: formatted per task description format above
   - `status`: `"open"`
2. Add checklist items via `checklist_add`
3. Add dependencies via `dependency_add`

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

1. **Always re-fetch the item first** — call `backlog_get` to get the latest state. Another agent or a human may have updated the description, checklist, comments, or status since you last saw it. Read all comments carefully — they may contain decisions, clarifications, or instructions that change how you should proceed.
2. Call `backlog_update` with `status: "in_progress"` on the chosen item
3. Work through the checklist **one item at a time, top to bottom**:
   - Read the checklist item
   - Do the work for that item
   - Call `checklist_update` with `checked: true` on the item **before** moving to the next one
   - For parent items with children: complete all children first, then check the parent
4. Never batch-check multiple items at the end — the kanban UI shows live progress, so each check should reflect real completed work
5. When all checklist items are done: call `backlog_update` with `status: "done"`, then call `comment_add` summarising what was done

### Search the backlog

1. Call `backlog_search` with a `query` string (case-insensitive substring match on title and description)
2. Optionally pass `status` to narrow results to `open`, `in_progress`, or `done`
3. Use this instead of `backlog_list` when the user is looking for a specific topic, RFC, or keyword

### Check what's blocking a task

1. Call `backlog_get` on the task
2. For each id in `dependencies`, call `backlog_get` to check its status
3. Report incomplete dependencies

## Important

- Always use MCP tools
- Never delete items — they are preserved for history
- When closing a done task: write docs first, then mark `done` and add a comment
