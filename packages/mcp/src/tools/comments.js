import { z } from "zod";

// Some MCP clients (e.g. Claude Code) serialize integer parameters as strings.
// Accept both and coerce to integer.
const IntField = z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]);

export function registerCommentTools(server, store, tool, ok) {
  tool(
    "comment_add",
    "Append a comment to a backlog item. Comments are append-only and do not require version checking. Author is always 'agent' via MCP; use the UI to add human comments.",
    {
      item_id: IntField,
      body: z.string().min(1),
    },
    async ({ item_id, body }) =>
      ok(await store.addComment(item_id, { body }))
  );
}
