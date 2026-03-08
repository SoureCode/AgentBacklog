import { validate, AddDependencySchema } from "@sourecode/agent-backlog-core/schemas.js";
import { parseBody, json, parsePositiveInt } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../sse/broadcaster.js";

export async function handleAddDependency(req, res, params, ctx) {
  const { store, projectSlug } = ctx;
  const item_id = parsePositiveInt(params.id, "id");
  const body = await parseBody(req);
  const data = validate(AddDependencySchema, body);
  const result = store.addDependency(item_id, data);
  broadcastProject(projectSlug);
  json(res, 201, result);
}
