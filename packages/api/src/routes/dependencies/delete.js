import { validate, RemoveDependencySchema } from "@sourecode/agent-backlog-core/schemas.js";
import { parseBody, json, parsePositiveInt } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../sse/broadcaster.js";

export async function handleDeleteDependency(req, res, params, ctx) {
  const { store, projectSlug } = ctx;
  const item_id = parsePositiveInt(params.id, "id");
  const depends_on_id = parsePositiveInt(params.did, "did");
  const body = await parseBody(req);
  const data = validate(RemoveDependencySchema, body);
  const result = store.removeDependency(item_id, { ...data, depends_on_id });
  broadcastProject(projectSlug);
  json(res, 200, result);
}
