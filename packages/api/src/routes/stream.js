import { sse } from "../sse/broadcaster.js";

export async function handleStream(req, res, _params, ctx) {
  const { store, projectSlug } = ctx;
  const cleanup = sse.register(projectSlug, res, store.listItems());
  req.on("close", cleanup);
}
