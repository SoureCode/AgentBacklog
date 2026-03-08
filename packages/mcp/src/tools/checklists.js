import { z } from "zod";

// Some MCP clients (e.g. Claude Code) serialize integer parameters as strings.
// Accept both and coerce to integer.
const IntField = z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]);
const VersionField = IntField.describe("The item's version number from your last backlog_get.");

export function registerChecklistTools(server, store, tool, ok) {
  tool(
    "checklist_add",
    "Add a checklist item to a backlog item. Requires the item's current 'version' for conflict detection. Use parent_id to nest under an existing checklist item.",
    {
      item_id: IntField,
      version: VersionField,
      label: z.string().min(1),
      parent_id: IntField.optional(),
    },
    async ({ item_id, version, label, parent_id }) =>
      ok(await store.addChecklist(item_id, { version, label, parent_id }))
  );

  tool(
    "checklist_update",
    "Update a checklist item's label or checked state. Requires the parent item's current 'version' for conflict detection.",
    {
      item_id: IntField,
      version: VersionField,
      id: IntField,
      label: z.string().min(1).optional(),
      checked: z.boolean().optional(),
    },
    async ({ item_id, version, id, label, checked }) =>
      ok(await store.updateChecklist(item_id, { version, id, label, checked }))
  );

  tool(
    "checklist_delete",
    "Delete a checklist item (cascades to children). Requires the parent item's current 'version' for conflict detection.",
    {
      item_id: IntField,
      version: VersionField,
      id: IntField,
    },
    async ({ item_id, version, id }) =>
      ok(await store.deleteChecklist(item_id, { version, id }))
  );
}
