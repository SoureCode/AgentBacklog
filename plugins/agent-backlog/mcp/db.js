import Database from "better-sqlite3";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname, basename } from "path";
import { homedir } from "os";

// ── project registry ──────────────────────────────────────────────────────

const REGISTRY_DIR = join(homedir(), ".config", "agent-backlog");
const REGISTRY_PATH = join(REGISTRY_DIR, "projects.json");

export function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) return { projects: {} };
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch {
    return { projects: {} };
  }
}

export function saveRegistry(registry) {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n", "utf8");
}

export function registerProject(projectRoot, dbPath) {
  const registry = loadRegistry();
  const slug = basename(projectRoot);
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
  const slug = basename(projectRoot);
  delete registry.projects[slug];
  saveRegistry(registry);
}

// ── database setup ────────────────────────────────────────────────────────

export function openDatabase(dbPath) {
  const db = new Database(dbPath);
  // Switch from WAL to DELETE journal mode so every write flushes directly
  // to the .db file, making it git-committable after each action.
  // wal_checkpoint(TRUNCATE) ensures any prior WAL content is merged first.
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("journal_mode = DELETE");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 255),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'done')),
      description TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES checklist_items(id) ON DELETE CASCADE,
      label TEXT NOT NULL CHECK(length(label) >= 1),
      checked INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      author TEXT NOT NULL DEFAULT 'agent' CHECK(author IN ('agent', 'human')),
      body TEXT NOT NULL CHECK(length(body) >= 1),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dependencies (
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      depends_on_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, depends_on_id),
      CHECK(item_id != depends_on_id)
    );

    CREATE INDEX IF NOT EXISTS idx_checklist_item ON checklist_items(item_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_parent ON checklist_items(parent_id);
    CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_id);
    CREATE INDEX IF NOT EXISTS idx_dependencies_item ON dependencies(item_id);
    CREATE INDEX IF NOT EXISTS idx_dependencies_depends_on ON dependencies(depends_on_id);
    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
    CREATE INDEX IF NOT EXISTS idx_items_updated_at ON items(updated_at DESC);
  `);

  // Migration: add version column to existing databases
  try {
    db.exec("ALTER TABLE items ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
  } catch {
    // Column already exists
  }

  return db;
}

// ── prepared statements factory ───────────────────────────────────────────

export function prepareStatements(db) {
  return {
    listItems: db.prepare("SELECT * FROM items ORDER BY id"),
    listItemsByStatus: db.prepare("SELECT * FROM items WHERE status = ? ORDER BY id"),
    getItem: db.prepare("SELECT * FROM items WHERE id = ?"),
    createItem: db.prepare(
      "INSERT INTO items (title, status, description, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
    ),
    updateItem: db.prepare(
      "UPDATE items SET title = ?, description = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?"
    ),
    touchItem: db.prepare(
      "UPDATE items SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?"
    ),

    getChecklistItem: db.prepare("SELECT * FROM checklist_items WHERE id = ? AND item_id = ?"),
    getChecklistByParent: db.prepare(
      "SELECT * FROM checklist_items WHERE item_id = ? AND parent_id = ? ORDER BY position"
    ),
    getTopChecklist: db.prepare(
      "SELECT * FROM checklist_items WHERE item_id = ? AND parent_id IS NULL ORDER BY position"
    ),
    countChecklistByParent: db.prepare(
      "SELECT COUNT(*) as cnt FROM checklist_items WHERE item_id = ? AND parent_id = ?"
    ),
    countTopChecklist: db.prepare(
      "SELECT COUNT(*) as cnt FROM checklist_items WHERE item_id = ? AND parent_id IS NULL"
    ),
    addChecklist: db.prepare(
      "INSERT INTO checklist_items (item_id, parent_id, label, checked, position) VALUES (?, ?, ?, 0, ?)"
    ),
    updateChecklist: db.prepare(
      "UPDATE checklist_items SET label = ?, checked = ? WHERE id = ?"
    ),
    deleteChecklist: db.prepare("DELETE FROM checklist_items WHERE id = ?"),
    getChecklistChildren: db.prepare("SELECT id FROM checklist_items WHERE parent_id = ?"),

    addComment: db.prepare(
      "INSERT INTO comments (item_id, author, body, created_at) VALUES (?, ?, ?, ?)"
    ),
    getComments: db.prepare("SELECT * FROM comments WHERE item_id = ? ORDER BY created_at"),

    getDeps: db.prepare("SELECT depends_on_id FROM dependencies WHERE item_id = ?"),
    addDep: db.prepare("INSERT OR IGNORE INTO dependencies (item_id, depends_on_id) VALUES (?, ?)"),
    removeDep: db.prepare("DELETE FROM dependencies WHERE item_id = ? AND depends_on_id = ?"),

    countChecklistTotal: db.prepare(
      "SELECT COUNT(*) as cnt FROM checklist_items WHERE item_id = ?"
    ),
    countChecklistDone: db.prepare(
      "SELECT COUNT(*) as cnt FROM checklist_items WHERE item_id = ? AND checked = 1"
    ),

    deleteItem: db.prepare("DELETE FROM items WHERE id = ?"),

    countItemsByStatus: db.prepare(
      "SELECT status, COUNT(*) as cnt FROM items GROUP BY status"
    ),
  };
}

// ── query helpers ─────────────────────────────────────────────────────────

export function now() {
  return new Date().toISOString();
}

export function requireItem(stmts, id) {
  const item = stmts.getItem.get(id);
  if (!item) throw new Error(`BacklogItem ${id} not found`);
  return item;
}

export const CHECKLIST_MAX_DEPTH = 10;

export function buildChecklistTree(stmts, itemId, parentId, depth = 0, maxDepth = CHECKLIST_MAX_DEPTH) {
  if (depth > maxDepth) {
    throw new Error(
      `Checklist nesting exceeds maximum allowed depth of ${maxDepth}. ` +
      `Restructure the checklist to reduce nesting.`
    );
  }

  const rows = parentId === null
    ? stmts.getTopChecklist.all(itemId)
    : stmts.getChecklistByParent.all(itemId, parentId);

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    checked: !!row.checked,
    position: row.position,
    children: buildChecklistTree(stmts, itemId, row.id, depth + 1, maxDepth),
  }));
}

export function fullItem(stmts, id) {
  const item = requireItem(stmts, id);
  return {
    ...item,
    checklist: buildChecklistTree(stmts, item.id, null),
    dependencies: stmts.getDeps.all(item.id).map((d) => ({ depends_on_id: d.depends_on_id })),
    comments: stmts.getComments.all(item.id),
  };
}

export function summarize(stmts, item) {
  const total = stmts.countChecklistTotal.get(item.id).cnt;
  const done = stmts.countChecklistDone.get(item.id).cnt;
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    version: item.version,
    updated_at: item.updated_at,
    dependencies: stmts.getDeps.all(item.id).map((d) => d.depends_on_id),
    checklist: total > 0 ? { total, done } : undefined,
  };
}

export function allSummaries(stmts, status) {
  const items = status ? stmts.listItemsByStatus.all(status) : stmts.listItems.all();
  return items.map((item) => summarize(stmts, item));
}

export function deleteChecklistRecursive(stmts, id) {
  const children = stmts.getChecklistChildren.all(id);
  for (const child of children) {
    deleteChecklistRecursive(stmts, child.id);
  }
  stmts.deleteChecklist.run(id);
}

export function wouldCycle(stmts, fromId, toId) {
  const visited = new Set();
  const stack = [toId];
  while (stack.length) {
    const node = stack.pop();
    if (node === fromId) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const dep of stmts.getDeps.all(node)) {
      stack.push(dep.depends_on_id);
    }
  }
  return false;
}

// ── optimistic locking ────────────────────────────────────────────────────

export class VersionConflictError extends Error {
  constructor(id, expectedVersion, currentItem) {
    super(
      `CONFLICT: BacklogItem ${id} has been modified by another agent ` +
      `(your version: ${expectedVersion}, current version: ${currentItem.version}). ` +
      `Re-fetch the item with backlog_get(id: ${id}) to see the latest state, ` +
      `then retry your operation with the new version number.`
    );
    this.name = "VersionConflictError";
    this.currentItem = currentItem;
  }
}

export function requireVersion(stmts, id, version) {
  const item = requireItem(stmts, id);
  if (item.version !== version) {
    throw new VersionConflictError(id, version, fullItem(stmts, id));
  }
  return item;
}

export function bumpVersion(stmts, id, version) {
  const result = stmts.touchItem.run(now(), id, version);
  if (result.changes === 0) {
    throw new VersionConflictError(id, version, fullItem(stmts, id));
  }
}

// ── UI leader election ────────────────────────────────────────────────────

const LOCK_PATH = join(REGISTRY_DIR, "ui.lock");

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLock() {
  if (!existsSync(LOCK_PATH)) return null;
  try {
    return JSON.parse(readFileSync(LOCK_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeLock(pid, port) {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(LOCK_PATH, JSON.stringify({ pid, port, started: now() }) + "\n", "utf8");
}

function removeLock() {
  try { unlinkSync(LOCK_PATH); } catch { /* ignore */ }
}

export function tryBecomeUILeader(port) {
  const lock = readLock();
  if (lock && isProcessAlive(lock.pid)) {
    return { isLeader: false, port: lock.port };
  }
  // Stale lock or no lock — claim it
  writeLock(process.pid, port);
  return { isLeader: true, port };
}

export function releaseUILeadership() {
  const lock = readLock();
  if (lock && lock.pid === process.pid) {
    removeLock();
  }
}

export function getUILeaderPort() {
  const lock = readLock();
  if (lock && isProcessAlive(lock.pid)) return lock.port;
  return null;
}
