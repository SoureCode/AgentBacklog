import { z } from "zod";
import { AgentStatusEnum, TitleField } from "@sourecode/agent-backlog-core/schemas.js";

// Some MCP clients (e.g. Claude Code) serialize integer parameters as strings.
// Accept both and coerce to integer.
const IntField = z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]);
const VersionField = IntField.describe("The version number from your last backlog_get. Required for conflict detection.");

export function registerItemTools(server, store, tool, ok) {
  tool(
    "backlog_list",
    "List backlog items, optionally filtered by status. Each item includes a 'version' field for optimistic locking.",
    { status: AgentStatusEnum.optional() },
    async ({ status }) => ok(await store.listItems(status, { includeArchived: false }))
  );

  tool(
    "backlog_get",
    "Get a single backlog item with its full details. The returned 'version' field must be passed to any subsequent update operation on this item.",
    { id: IntField },
    async ({ id }) => ok(await store.getItem(id))
  );

  tool(
    "backlog_create",
    "Create a new backlog item. Returns the item with version 1.",
    {
      title: TitleField,
      description: z.string().optional(),
      status: AgentStatusEnum.optional(),
    },
    async ({ title, description, status }) =>
      ok(await store.createItem({ title, description, status }))
  );

  tool(
    "backlog_update",
    "Update a backlog item's title, description, or status. Requires the 'version' from your last read of this item. If another agent modified the item since you read it, this will fail with a CONFLICT error — re-fetch with backlog_get and retry.",
    {
      id: IntField,
      version: VersionField,
      title: TitleField.optional(),
      description: z.string().optional(),
      status: AgentStatusEnum.optional(),
    },
    async ({ id, version, title, description, status }) =>
      ok(await store.updateItem(id, { version, title, description, status }))
  );

  tool(
    "backlog_search",
    "Search backlog items by one or more keywords. Supports quoted phrases (\"exact match\"). Items are ranked by relevance: title matches score higher than description matches. All tokens must appear somewhere in the item (AND logic). Optionally filter by status.",
    {
      query: z.string().min(1),
      status: AgentStatusEnum.optional(),
    },
    async ({ query, status }) =>
      ok(await store.searchItems(query, status))
  );

  tool(
    "backlog_delete",
    "Delete a backlog item. The item will no longer appear in backlog_list. Requires the item's current 'version' for conflict detection.",
    {
      id: IntField,
      version: VersionField,
    },
    async ({ id, version }) =>
      ok(await store.updateItem(id, { version, status: "archived" }))
  );
}
