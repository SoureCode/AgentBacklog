import { z } from "zod";

// Some MCP clients (e.g. Claude Code) serialize integer parameters as strings.
// Accept both and coerce to integer.
const IntField = z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]);
const VersionField = IntField.describe("The item's version number from your last backlog_get.");

export function registerDependencyTools(server, store, tool, ok) {
  tool(
    "dependency_add",
    "Add a dependency: item_id depends on depends_on_id. Requires the item's current 'version' for conflict detection.",
    {
      item_id: IntField,
      version: VersionField,
      depends_on_id: IntField,
    },
    async ({ item_id, version, depends_on_id }) =>
      ok(await store.addDependency(item_id, { version, depends_on_id }))
  );

  tool(
    "dependency_remove",
    "Remove a dependency between two items. Requires the item's current 'version' for conflict detection.",
    {
      item_id: IntField,
      version: VersionField,
      depends_on_id: IntField,
    },
    async ({ item_id, version, depends_on_id }) =>
      ok(await store.removeDependency(item_id, { version, depends_on_id }))
  );
}
