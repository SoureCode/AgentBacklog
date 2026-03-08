import { requireItem, bumpVersion } from "@sourecode/agent-backlog-core/db/queries.js";
import { validate, PatchChecklistBodySchema } from "@sourecode/agent-backlog-core/schemas.js";
import { parseBody } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../local/pool.js";

export function handleUpdateChecklist(stmts, slug, req, itemId, cid) {
  return async () => {
    const body = await parseBody(req);
    const fields = validate(PatchChecklistBodySchema, body);
    const item = requireItem(stmts, itemId);
    const entry = stmts.getChecklistItem.get(cid, itemId);
    if (!entry) return { status: 404, body: { error: "checklist item not found" } };
    stmts.updateChecklist.run(
      fields.label ?? entry.label,
      fields.checked !== undefined ? (fields.checked ? 1 : 0) : entry.checked,
      cid
    );
    bumpVersion(stmts, itemId, item.version);
    const updated = stmts.getChecklistItem.get(cid, itemId);
    broadcastProject(slug);
    return { status: 200, body: { id: updated.id, label: updated.label, checked: !!updated.checked, position: updated.position, children: [] } };
  };
}
