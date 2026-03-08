import { validate, UpdateChecklistSchema } from "@sourecode/agent-backlog-core/schemas.js";
import { parseBody, json, parsePositiveInt } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../sse/broadcaster.js";

export async function handleUpdateChecklist(req, res, params, ctx) {
  const { store, projectSlug } = ctx;
  const item_id = parsePositiveInt(params.id, "id");
  const cid = parsePositiveInt(params.cid, "cid");
  const body = await parseBody(req);
  const data = validate(UpdateChecklistSchema, body);
  const result = store.updateChecklist(item_id, { ...data, id: cid });
  broadcastProject(projectSlug);
  json(res, 200, result);
}
