---
description: Mark a task as done with a summary comment
argument-hint: <task id>
allowed-tools: [mcp__agent-backlog__backlog_get, mcp__agent-backlog__backlog_update, mcp__agent-backlog__checklist_update, mcp__agent-backlog__comment_add, AskUserQuestion]
---

# Complete Task

Mark a backlog task as done.

User arguments: $ARGUMENTS

## Instructions

1. Parse the task ID from arguments. If not provided, ask the user which task to complete.
2. Call `backlog_get` to fetch the full task
3. Check the checklist for unchecked items:
   - If there are unchecked items, show them and ask the user:
     - "These checklist items are still unchecked. Should I mark them all as done, or is this task not fully complete?"
   - If user confirms, mark all unchecked items via `checklist_update` with `checked: true`
4. Call `backlog_update` with `status: "done"`
5. Call `comment_add` with a brief summary of what was accomplished (derive from the checked checklist items and task description)
6. Confirm completion to the user
