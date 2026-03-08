import { json, parsePositiveInt } from "@sourecode/agent-backlog-core/http/helpers.js";

export async function handleGetItem(req, res, params, ctx) {
  const { store } = ctx;
  const id = parsePositiveInt(params.id, "id");
  json(res, 200, store.getItem(id));
}
