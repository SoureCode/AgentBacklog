import { requireItem, bumpVersion, now } from "@sourecode/agent-backlog-core/db/queries.js";
import { validate, AddCommentSchema } from "@sourecode/agent-backlog-core/schemas.js";
import { parseBody } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../local/pool.js";

export function handleAddComment(stmts, slug, req, itemId) {
  return async () => {
    const body = await parseBody(req);
    const { body: commentBody } = validate(AddCommentSchema, body);
    const item = requireItem(stmts, itemId);
    const ts = now();
    const result = stmts.addComment.run(itemId, "human", commentBody.trim(), ts);
    bumpVersion(stmts, itemId, item.version);
    broadcastProject(slug);
    return { status: 201, body: { id: Number(result.lastInsertRowid), author: "human", body: commentBody.trim(), created_at: ts } };
  };
}
