import { fullItem, requireItem, now } from "@sourecode/agent-backlog-core/db/queries.js";
import { validate, PatchItemBodySchema } from "@sourecode/agent-backlog-core/schemas.js";
import { parseBody } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../local/pool.js";

export function handleUpdateItem(stmts, slug, req, id) {
  return async () => {
    const body = await parseBody(req);
    const fields = validate(PatchItemBodySchema, body);
    const item = requireItem(stmts, id);
    const versionHeader = req.headers["if-match"];
    const expectedVersion = versionHeader ? parseInt(versionHeader, 10) : fields.version;
    if (expectedVersion !== undefined && expectedVersion !== item.version) {
      const current = fullItem(stmts, id);
      return { status: 409, body: { error: "Version conflict", current }, headers: { ETag: String(item.version) } };
    }
    const result = stmts.updateItem.run(
      fields.title ?? item.title,
      fields.description ?? item.description,
      fields.status ?? item.status,
      now(), id, item.version
    );
    if (result.changes === 0) {
      const current = fullItem(stmts, id);
      return { status: 409, body: { error: "Version conflict", current }, headers: { ETag: String(current.version) } };
    }
    const updated = fullItem(stmts, id);
    broadcastProject(slug);
    return { status: 200, body: updated, headers: { ETag: String(updated.version) } };
  };
}
