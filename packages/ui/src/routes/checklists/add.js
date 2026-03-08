import { requireItem, bumpVersion } from "@sourecode/agent-backlog-core/db/queries.js";
import { validate, AddChecklistBodySchema } from "@sourecode/agent-backlog-core/schemas.js";
import { parseBody } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../local/pool.js";

export function handleAddChecklist(stmts, slug, req, itemId) {
  return async () => {
    const body = await parseBody(req);
    const { label, parent_id } = validate(AddChecklistBodySchema, body);
    const item = requireItem(stmts, itemId);
    if (parent_id != null) {
      const parent = stmts.getChecklistItem.get(parent_id, itemId);
      if (!parent) return { status: 404, body: { error: "parent not found" } };
    }
    const position = parent_id != null
      ? stmts.countChecklistByParent.get(itemId, parent_id).cnt
      : stmts.countTopChecklist.get(itemId).cnt;
    const result = stmts.addChecklist.run(itemId, parent_id ?? null, label.trim(), position);
    bumpVersion(stmts, itemId, item.version);
    broadcastProject(slug);
    return { status: 201, body: { id: Number(result.lastInsertRowid), label: label.trim(), checked: false, position, children: [] } };
  };
}
