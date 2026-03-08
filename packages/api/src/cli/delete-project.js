import { unlinkSync } from "fs";
import { join } from "path";
import { loadApiKeys, saveApiKeys } from "../auth/auth.js";
import { API_DATA_DB_DIR } from "@sourecode/agent-backlog-core/config.js";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: delete-project <slug>");
  process.exit(1);
}

const keys = loadApiKeys();
let found = false;
for (const [key, entry] of Object.entries(keys)) {
  if (entry.slug === slug) {
    delete keys[key];
    found = true;
  }
}

if (!found) {
  console.error(`Project "${slug}" not found.`);
  process.exit(1);
}

saveApiKeys(keys);

const dbPath = join(API_DATA_DB_DIR, `${slug}.backlog.db`);
try {
  unlinkSync(dbPath);
  try { unlinkSync(dbPath + "-wal"); } catch (e) { if (e.code !== "ENOENT") console.warn("delete-project: failed to remove WAL file:", e.message); }
  try { unlinkSync(dbPath + "-shm"); } catch (e) { if (e.code !== "ENOENT") console.warn("delete-project: failed to remove SHM file:", e.message); }
  console.log(`Project "${slug}" deleted (DB removed).`);
} catch (e) {
  if (e.code !== "ENOENT") {
    console.error(`delete-project: failed to remove DB: ${e.message}`);
    process.exit(1);
  }
  console.log(`Project "${slug}" deleted (DB was already missing).`);
}
