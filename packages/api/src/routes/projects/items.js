import { json } from "@sourecode/agent-backlog-core/http/helpers.js";
import { projectExists } from "../../auth/projects.js";
import { getStoreForSlug } from "../../store/store.js";

export async function handleProjectItems(req, res, params, _ctx) {
  const projectSlug = params.slug;
  if (!projectExists(projectSlug)) {
    json(res, 404, { error: `Project "${projectSlug}" not found` });
    return;
  }
  const store = getStoreForSlug(projectSlug);
  json(res, 200, store.listItems());
}
