---
name: backlog-plan-and-work
description: >
  Creates a backlog task, plans it with checklist items by exploring the codebase, and immediately starts implementation.
  Use this skill when the user wants to work on something but there is no existing backlog item for it.
  Trigger on signals like: "implement X", "fix Y", "add feature Z", "I want to work on…", "let's build…",
  or any request to do work that doesn't reference an existing task ID. This skill creates the task first,
  then hands off to implementation.
---

# Plan and Work

When the user wants to work on something and there is no backlog task for it yet, this skill creates a well-planned task and starts implementation immediately.

## Critical rules

- **Always re-read before updating.** Before any mutating operation, call `backlog_get` to get the latest `version`. Never reuse a stale version.
- **Every task must have checklist items.** A task without a checklist cannot be tracked. Break work into small, verifiable steps.
- **Always comment your work.** Comment when creating (planning rationale), when starting (what you plan to do), after each checklist item (what was done), and when completing (summary of changes).
- The `.backlog.db` file is part of the repository — it should be committed alongside project changes.

## Process

### Phase 1: Check for duplicates

1. Call `backlog_search` with keywords from the user's request
2. If a matching task already exists, show it and ask the user whether to use it or create a new one
3. If using an existing task, skip to Phase 3

### Phase 2: Create and plan the task

1. **Explore the codebase**: Use `Glob`, `Grep`, and `Read` to understand the relevant code areas, existing patterns, and potential impact
2. **Create the task**: Call `backlog_create` with:
   - `title`: concise, descriptive title (max 255 chars)
   - `description`: formatted per the description format below
   - `status`: `"open"`
3. **Add checklist items** (mandatory): Re-read the item with `backlog_get` before each `checklist_add` call. Break the work into concrete, ordered steps. Each step should be independently verifiable. Use nesting for sub-steps.
4. **Add dependencies**: Call `backlog_list` to check if any existing items are prerequisites, and link them via `dependency_add`
5. **Comment**: Call `comment_add` to explain the planning rationale and key decisions

### Phase 3: Start implementation

1. **Re-read the task**: Call `backlog_get` to get the latest state. Read all comments — they may contain decisions or instructions.
2. **Set in-progress**: Call `backlog_update` with `status: "in_progress"` and the current `version`
3. **Comment**: Call `comment_add` noting what you plan to do
4. **Work through the checklist** one item at a time, top to bottom:
   a. Re-read: Call `backlog_get` before each checklist mutation to get the current `version`
   b. Explore: Use `Glob`, `Grep`, and `Read` to find the relevant code
   c. Implement: Use `Edit` and `Write` to make the changes
   d. Verify: Use `Bash` to run tests or lint checks if applicable
   e. Check off: Call `checklist_update` to mark the item as checked
   f. Comment: Call `comment_add` to note what was done
5. **Handle blockers**: If a checklist item cannot be completed:
   - Add a comment explaining the blocker
   - Do NOT mark the item as checked
   - Stop and report the blocker
6. **Complete the task**: When all checklist items are done:
   - Re-read with `backlog_get`
   - Call `backlog_update` with `status: "done"`
   - Call `comment_add` summarising all changes made

## Description format

```markdown
## Goal

What needs to be built/fixed and why. Include enough context for an implementer.

## Notes

- Relevant files and code areas discovered
- Architectural constraints or patterns to follow
- (omit if nothing meaningful)

## Acceptance

- Concrete, verifiable criterion
- Another criterion
```

## Guidelines

- Make focused, minimal changes for each checklist item
- Follow existing code patterns and conventions in the project
- Do not refactor or "improve" code beyond what the checklist item requires
- Run tests after changes when a test suite is available
- If a checklist item is ambiguous, add a comment asking for clarification rather than guessing

## Output

Return:
- Task ID and title
- Summary of changes made per checklist item
- Any blockers encountered
- Final task status
