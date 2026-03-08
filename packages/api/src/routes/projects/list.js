import { logger } from "@sourecode/agent-backlog-core/logger.js";
import { json } from "@sourecode/agent-backlog-core/http/helpers.js";
import { loadApiKeys } from "../../auth/auth.js";
import { getStoreForSlug } from "../../store/store.js";

export async function handleListProjects(req, res) {
  const keys = loadApiKeys();
  const slugs = new Set(Object.values(keys).map((k) => k.slug));
  const projects = [];
  for (const slug of slugs) {
    try {
      const store = getStoreForSlug(slug);
      const items = store.listItems();
      let open = 0, inProgress = 0, done = 0;
      for (const i of items) {
        if (i.status === "open") open++;
        else if (i.status === "in_progress") inProgress++;
        else if (i.status === "done") done++;
      }
      projects.push({ slug, open, in_progress: inProgress, done, total: items.length });
    } catch (e) {
      logger.error("api:project-list-error", { slug, error: e.message });
      projects.push({ slug, error: true });
    }
  }
  json(res, 200, projects);
}
