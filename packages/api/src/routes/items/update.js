import { validate, UpdateItemSchema } from "@sourecode/agent-backlog-core/schemas.js";
import { parseBody, json, parsePositiveInt } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../sse/broadcaster.js";

export async function handleUpdateItem(req, res, params, ctx) {
  const { store, projectSlug } = ctx;
  const id = parsePositiveInt(params.id, "id");
  const body = await parseBody(req);
  const data = validate(UpdateItemSchema, body);
  const result = store.updateItem(id, data);
  broadcastProject(projectSlug);
  json(res, 200, result);
}
