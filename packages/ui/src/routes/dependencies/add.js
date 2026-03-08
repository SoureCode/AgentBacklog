import { requireItem, requireVersion, bumpVersion, wouldCycle } from "@sourecode/agent-backlog-core/db/queries.js";
import { validate, AddDependencySchema } from "@sourecode/agent-backlog-core/schemas.js";
import { parseBody } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../local/pool.js";

export function handleAddDependency(stmts, slug, req, itemId) {
  return async () => {
    const body = await parseBody(req);
    const { version, depends_on_id } = validate(AddDependencySchema, body);
    if (itemId === depends_on_id) throw new Error("An item cannot depend on itself");
    requireVersion(stmts, itemId, version);
    requireItem(stmts, depends_on_id);
    if (wouldCycle(stmts, itemId, depends_on_id)) {
      throw new Error(`Adding this dependency would create a cycle: ${itemId} → ${depends_on_id}`);
    }
    stmts.addDep.run(itemId, depends_on_id);
    bumpVersion(stmts, itemId, version);
    broadcastProject(slug);
    return { status: 201, body: { item_id: itemId, depends_on_id, item_version: version + 1 } };
  };
}
