---
description: Create a new backlog task with description and checklist
argument-hint: <task title or description>
allowed-tools: [mcp__agent-backlog__backlog_create, mcp__agent-backlog__backlog_list, mcp__agent-backlog__checklist_add, mcp__agent-backlog__dependency_add, mcp__agent-backlog__backlog_search, AskUserQuestion]
---

# Create Backlog Task

Create a new backlog item from the user's request.

User request: $ARGUMENTS

## Instructions

1. Parse the user's request to extract the task intent
2. If the request is vague, ask the user to clarify the goal and scope
3. Call `backlog_search` to check for duplicate or related existing tasks
4. If duplicates exist, show them and ask the user whether to proceed or update the existing task
5. Call `backlog_create` with:
   - `title`: concise, descriptive title (max 255 chars)
   - `description`: formatted as below
   - `status`: `"open"`
6. Break the task into concrete steps and add each as a checklist item via `checklist_add`
7. Call `backlog_list` to check if any existing items should be dependencies, and add them via `dependency_add`
8. Display the created task summary

## Description format

```markdown
## Goal

What needs to be built and why.

## Notes

- Constraints, decisions, relevant context
- (omit this section if nothing meaningful to say)

## Acceptance

- Concrete, verifiable criterion
- Another criterion
```
