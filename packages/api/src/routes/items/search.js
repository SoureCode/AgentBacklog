import { json } from "@sourecode/agent-backlog-core/http/helpers.js";

export async function handleSearchItems(req, res, _params, ctx) {
  const { url, store } = ctx;
  const q = url.searchParams.get("q");
  if (!q) { json(res, 400, { error: "q parameter required" }); return; }
  const status = url.searchParams.get("status") || undefined;
  const includeArchived = url.searchParams.get("exclude_archived") !== "1";
  json(res, 200, store.searchItems(q, status, { includeArchived }));
}
