import { LocalStore } from "@sourecode/agent-backlog-core/store/local.js";
import { API_DATA_DB_DIR } from "@sourecode/agent-backlog-core/config.js";
import { join } from "path";

export function getStoreForSlug(slug) {
  const dbPath = join(API_DATA_DB_DIR, `${slug}.backlog.db`);
  return new LocalStore(dbPath);
}
