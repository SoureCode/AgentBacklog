import { validate, AddChecklistSchema } from "@sourecode/agent-backlog-core/schemas.js";
import { parseBody, json, parsePositiveInt } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../sse/broadcaster.js";

export async function handleAddChecklist(req, res, params, ctx) {
  const { store, projectSlug } = ctx;
  const item_id = parsePositiveInt(params.id, "id");
  const body = await parseBody(req);
  const data = validate(AddChecklistSchema, body);
  const result = store.addChecklist(item_id, data);
  broadcastProject(projectSlug);
  json(res, 201, result);
}
