import { requireItem } from "@sourecode/agent-backlog-core/db/queries.js";
import { broadcastProject } from "../../local/pool.js";

export function handleDeleteItem(stmts, slug, id) {
  requireItem(stmts, id);
  stmts.deleteItem.run(id);
  broadcastProject(slug);
  return { status: 200, body: { deleted: id } };
}
