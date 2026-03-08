import { requireItem, bumpVersion, deleteChecklistRecursive } from "@sourecode/agent-backlog-core/db/queries.js";
import { broadcastProject } from "../../local/pool.js";

export function handleDeleteChecklist(stmts, slug, itemId, cid) {
  const item = requireItem(stmts, itemId);
  const entry = stmts.getChecklistItem.get(cid, itemId);
  if (!entry) return { status: 404, body: { error: "checklist item not found" } };
  deleteChecklistRecursive(stmts, cid);
  bumpVersion(stmts, itemId, item.version);
  broadcastProject(slug);
  return { status: 200, body: { deleted: cid } };
}
