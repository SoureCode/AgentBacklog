import { requireVersion, bumpVersion } from "@sourecode/agent-backlog-core/db/queries.js";
import { validate, RemoveDependencySchema } from "@sourecode/agent-backlog-core/schemas.js";
import { parseBody } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../local/pool.js";

export function handleDeleteDependency(stmts, slug, req, itemId, depId) {
  return async () => {
    const body = await parseBody(req);
    const { version } = validate(RemoveDependencySchema, body);
    requireVersion(stmts, itemId, version);
    const result = stmts.removeDep.run(itemId, depId);
    if (result.changes === 0) throw new Error(`Dependency ${itemId} → ${depId} does not exist`);
    bumpVersion(stmts, itemId, version);
    broadcastProject(slug);
    return { status: 200, body: { removed: { item_id: itemId, depends_on_id: depId }, item_version: version + 1 } };
  };
}
