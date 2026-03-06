import { join } from "path";
import { LocalStore } from "./store-local.js";
import { RemoteStore } from "./store-remote.js";

export { VersionConflictError } from "./db.js";

export function createStore({ projectRoot } = {}) {
  const apiUrl = process.env.BACKLOG_API_URL;
  const apiKey = process.env.BACKLOG_API_KEY;
  if (apiUrl && apiKey) {
    return new RemoteStore(apiUrl, apiKey);
  }
  const dbPath = process.env.BACKLOG_FILE ?? join(projectRoot, ".backlog.db");
  return new LocalStore(dbPath);
}
