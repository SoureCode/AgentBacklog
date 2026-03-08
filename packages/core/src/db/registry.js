import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, copyFileSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";
import { REGISTRY_DIR, DATA_DIR, REGISTRY_PATH } from "../config/config.js";
import { logger } from "../logger.js";

// ── project registry ──────────────────────────────────────────────────────

export function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) return { projects: {} };
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch (e) {
    logger.warn("registry:parse-error", { error: e.message });
    return { projects: {} };
  }
}

export function saveRegistry(registry) {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n", "utf8");
}

function slugForProject(registry, projectRoot) {
  const base = basename(projectRoot);
  // If slug is unused or already points to this root, use it as-is
  const existing = registry.projects[base];
  if (!existing || existing.root === projectRoot) return base;
  // Collision: append a short hash of the full path
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

export function resolveProjectDb(projectRoot) {
  mkdirSync(DATA_DIR, { recursive: true });
  const registry = loadRegistry();
  // Reuse existing slug/path if already registered
  for (const [slug, entry] of Object.entries(registry.projects)) {
    if (entry.root === projectRoot) {
      return { slug, dbPath: entry.db };
    }
  }
  const slug = slugForProject(registry, projectRoot);
  return { slug, dbPath: join(DATA_DIR, `${slug}.db`) };
}

export function migrateAllProjects() {
  mkdirSync(DATA_DIR, { recursive: true });
  const registry = loadRegistry();
  let changed = false;

  for (const [slug, entry] of Object.entries(registry.projects)) {
    const newPath = join(DATA_DIR, `${slug}.db`);
    if (entry.db === newPath) continue; // already in the right place

    if (existsSync(entry.db)) {
      // Move the file to the new location (copy + delete original)
      copyFileSync(entry.db, newPath);
      unlinkSync(entry.db);
    }

    entry.db = newPath;
    changed = true;
  }

  if (changed) saveRegistry(registry);
}

export function registerProject(projectRoot, dbPath) {
  const registry = loadRegistry();
  // Check if this root is already registered under any slug
  for (const [slug, entry] of Object.entries(registry.projects)) {
    if (entry.root === projectRoot) {
      entry.db = dbPath;
      entry.lastSeen = new Date().toISOString();
      saveRegistry(registry);
      return slug;
    }
  }
  const slug = slugForProject(registry, projectRoot);
  registry.projects[slug] = {
    root: projectRoot,
    db: dbPath,
    lastSeen: new Date().toISOString(),
  };
  saveRegistry(registry);
  return slug;
}

export function unregisterProject(projectRoot) {
  const registry = loadRegistry();
  for (const [slug, entry] of Object.entries(registry.projects)) {
    if (entry.root === projectRoot) {
      delete registry.projects[slug];
      saveRegistry(registry);
      return;
    }
  }
}
