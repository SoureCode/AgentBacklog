import { json, parsePositiveInt } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../sse/broadcaster.js";

export async function handleDeleteItem(req, res, params, ctx) {
  const { store, projectSlug } = ctx;
  const id = parsePositiveInt(params.id, "id");
  const result = store.deleteItem(id);
  broadcastProject(projectSlug);
  json(res, 200, result);
}
