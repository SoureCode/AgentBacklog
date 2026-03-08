import { existsSync } from "fs";
import { join } from "path";
import { loadApiKeys } from "../auth/auth.js";
import { API_DATA_DB_DIR } from "@sourecode/agent-backlog-core/config.js";

const keys = loadApiKeys();
const slugs = new Map();

for (const [key, entry] of Object.entries(keys)) {
  if (!slugs.has(entry.slug)) {
    slugs.set(entry.slug, { keys: [], created: entry.created });
  }
  slugs.get(entry.slug).keys.push(key);
}

if (slugs.size === 0) {
  console.log("No projects.");
} else {
  for (const [slug, info] of slugs) {
    const dbPath = join(API_DATA_DB_DIR, `${slug}.backlog.db`);
    const exists = existsSync(dbPath);
    console.log(`${slug} (db: ${exists ? "exists" : "missing"}, keys: ${info.keys.length})`);
  }
}
