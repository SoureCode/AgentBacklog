---
description: Find and start the next task to work on
allowed-tools: [mcp__agent-backlog__backlog_list, mcp__agent-backlog__backlog_get, mcp__agent-backlog__backlog_update, mcp__agent-backlog__comment_add, AskUserQuestion]
---

# Next Task

Find the best task to work on next and optionally start it.

## Critical rules

- **Always re-read before updating.** Before any mutating operation (`backlog_update`), call `backlog_get` to get the latest `version`. Never reuse a stale version.
- **Always comment your work.** When starting a task, add a comment noting what you plan to do.
- The `.backlog.db` file is part of the repository — it should be committed alongside project changes.

## Instructions

1. Call `backlog_list` to get all items
2. Check for `in_progress` tasks first:
   - If found, call `backlog_get` on each to show full details
   - Present them as "Resume these first" with their checklist progress
   - Ask the user if they want to resume one of these
3. If no in-progress tasks (or user wants something new):
   - Among `open` tasks, call `backlog_get` on each to check dependencies
   - Identify tasks where all dependencies have `status: done` (ready to start)
   - Present ready tasks sorted by priority (fewer dependencies = higher priority)
   - Show blocked tasks separately with what's blocking them
4. Ask the user which task they want to start
5. When the user picks a task:
   - Call `backlog_update` with `status: "in_progress"`
   - Call `comment_add` noting the task was started
   - Display the full task with its checklist as a work plan
