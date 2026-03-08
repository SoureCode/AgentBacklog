import { json } from "@sourecode/agent-backlog-core/http/helpers.js";
import { projectExists } from "../../auth/projects.js";
import { getStoreForSlug } from "../../store/store.js";
import { sse } from "../../sse/broadcaster.js";

export async function handleProjectStream(req, res, params, _ctx) {
  const projectSlug = params.slug;
  if (!projectExists(projectSlug)) {
    json(res, 404, { error: `Project "${projectSlug}" not found` });
    return;
  }
  const store = getStoreForSlug(projectSlug);
  const cleanup = sse.register(projectSlug, res, store.listItems());
  req.on("close", cleanup);
}
