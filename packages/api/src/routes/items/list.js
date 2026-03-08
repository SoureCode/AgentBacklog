import { json } from "@sourecode/agent-backlog-core/http/helpers.js";

export async function handleListItems(req, res, _params, ctx) {
  const { url, store } = ctx;
  const status = url.searchParams.get("status") || undefined;
  const includeArchived = url.searchParams.get("exclude_archived") !== "1";
  json(res, 200, store.listItems(status, { includeArchived }));
}
