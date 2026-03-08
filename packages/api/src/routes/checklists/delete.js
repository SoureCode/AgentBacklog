import { validate, DeleteChecklistSchema } from "@sourecode/agent-backlog-core/schemas.js";
import { parseBody, json, parsePositiveInt } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../sse/broadcaster.js";

export async function handleDeleteChecklist(req, res, params, ctx) {
  const { store, projectSlug } = ctx;
  const item_id = parsePositiveInt(params.id, "id");
  const cid = parsePositiveInt(params.cid, "cid");
  const body = await parseBody(req);
  const { version } = validate(DeleteChecklistSchema, body);
  const result = store.deleteChecklist(item_id, { version, id: cid });
  broadcastProject(projectSlug);
  json(res, 200, result);
}
