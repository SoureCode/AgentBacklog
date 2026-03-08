import Database from "better-sqlite3";
import { logger } from "../logger.js";

// ── database setup ────────────────────────────────────────────────────────

function tryDeleteJournalMode(db) {
  // Merge any WAL content, then switch to DELETE journal mode so writes go
  // directly to the .db file (git-committable). The switch silently fails
  // if another connection holds the DB open — that's OK, we retry on close.
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch (e) { logger.warn("db:wal-checkpoint-failed", { error: e.message }); }
  db.pragma("journal_mode = DELETE");
}

export function closeDatabase(db) {
  // With no other connections, we can now flush WAL and switch to DELETE.
  tryDeleteJournalMode(db);
  db.close();
}

export function openDatabase(dbPath) {
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 5000");
  // Merge any prior WAL content, then switch to DELETE journal mode so
  // writes go directly to the .db file (git-committable after each action).
  // journal_mode = DELETE will silently fail if another connection holds
  // the DB open, so we verify and retry on close via closeDatabase().
  tryDeleteJournalMode(db);
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 255),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'done', 'archived')),
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
  } catch (e) {
    if (!e.message.includes("duplicate column")) logger.warn("db:migration-warning", { error: e.message });
  }

  // Migration: expand status CHECK constraint to include 'archived'
  // SQLite doesn't support ALTER CONSTRAINT, so we recreate the table.
  // We detect the need by inspecting the schema SQL directly — a dummy
  // UPDATE WHERE 0 never triggers the constraint, so it can't be used.
  {
    const tableSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='items'").get();
    if (tableSchema && !tableSchema.sql.includes("'archived'")) {
      db.exec(`
        CREATE TABLE items_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 255),
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'done', 'archived')),
          description TEXT NOT NULL DEFAULT '',
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO items_new SELECT id, title, status, description, version, created_at, updated_at FROM items;
        DROP TABLE items;
        ALTER TABLE items_new RENAME TO items;
        CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
        CREATE INDEX IF NOT EXISTS idx_items_updated_at ON items(updated_at DESC);
      `);
    }
  }

  return db;
}
