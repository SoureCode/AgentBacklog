import { openDatabase } from "@sourecode/agent-backlog-core/db/schema.js";
import { prepareStatements } from "@sourecode/agent-backlog-core/db/statements.js";
import { loadRegistry } from "@sourecode/agent-backlog-core/db/registry.js";
import { allSummaries } from "@sourecode/agent-backlog-core/db/queries.js";
import { existsSync } from "fs";
import { SSEBroadcaster } from "@sourecode/agent-backlog-core/http/sse.js";
import { logger } from "@sourecode/agent-backlog-core/logger.js";

export const dbPool = new Map();
export const sse = new SSEBroadcaster("ui");

export function getProject(slug) {
  if (dbPool.has(slug)) return dbPool.get(slug);

  const registry = loadRegistry();
  const project = registry.projects[slug];
  if (!project) return null;
  if (!existsSync(project.db)) return null;

  const db = openDatabase(project.db);
  const stmts = prepareStatements(db);
  const entry = { db, stmts, ...project };
  dbPool.set(slug, entry);
  return entry;
}

export function listProjects() {
  const registry = loadRegistry();
  const projects = [];
  for (const [slug, project] of Object.entries(registry.projects)) {
    if (!existsSync(project.db)) continue;
    try {
      const p = getProject(slug);
      if (p) {
        const counts = p.stmts.countItemsByStatus.all();
        const byStatus = Object.fromEntries(counts.map((r) => [r.status, r.cnt]));
        const open = byStatus.open ?? 0;
        const inProgress = byStatus.in_progress ?? 0;
        const done = byStatus.done ?? 0;
        const archived = byStatus.archived ?? 0;
        const total = open + inProgress + done + archived;
        projects.push({ slug, root: project.root, open, in_progress: inProgress, done, archived, total });
      }
    } catch (e) {
      logger.warn("ui:project-load-error", { slug, error: e.message });
      projects.push({ slug, root: project.root, error: true });
    }
  }
  return projects;
}

export function broadcastProject(slug, onlyIfChanged = false) {
  const project = getProject(slug);
  if (!project) return;
  sse.broadcast(slug, allSummaries(project.stmts), onlyIfChanged);
}
