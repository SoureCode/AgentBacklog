---
description: Show the backlog, search tasks, or find what to work on next
argument-hint: [search query]
allowed-tools: [mcp__agent-backlog__backlog_list, mcp__agent-backlog__backlog_get, mcp__agent-backlog__backlog_search]
---

# Backlog

Show the current state of the backlog.

User arguments: $ARGUMENTS

## Instructions

If the user provided arguments, treat them as a search query:
1. Call `backlog_search` with the arguments as `query`
2. Display results as a table: ID | Title | Status
3. If no results, suggest broadening the search

If no arguments were provided, show the full backlog:
1. Call `backlog_list` with no filter
2. Group items by status: `in_progress` first, then `open`, then `done`
3. Display as a table: ID | Title | Status | Checklist progress (e.g. 3/5)
4. Highlight `in_progress` items as "resume these first"
5. Among `open` items, call `backlog_get` on each to check dependencies
6. Mark items where all dependencies are `done` as "ready to start"
7. If there are blocked items, list what's blocking them
