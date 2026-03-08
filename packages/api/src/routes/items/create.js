import { validate, CreateItemSchema } from "@sourecode/agent-backlog-core/schemas.js";
import { parseBody, json } from "@sourecode/agent-backlog-core/http/helpers.js";
import { broadcastProject } from "../../sse/broadcaster.js";

export async function handleCreateItem(req, res, params, ctx) {
  const { store, projectSlug } = ctx;
  const body = await parseBody(req);
  const data = validate(CreateItemSchema, body);
  const item = store.createItem(data);
  broadcastProject(projectSlug);
  json(res, 201, item);
}
