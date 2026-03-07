import { LocalStore } from "./store-local.js";
import { RemoteStore } from "./store-remote.js";
import { resolveProjectDb } from "./db.js";

export { VersionConflictError } from "./db.js";

export function createStore({ projectRoot } = {}) {
  const apiUrl = process.env.BACKLOG_API_URL;
  const apiKey = process.env.BACKLOG_API_KEY;
  if (apiUrl && apiKey) {
    return new RemoteStore(apiUrl, apiKey);
  }
  const dbPath = process.env.BACKLOG_FILE ?? resolveProjectDb(projectRoot).dbPath;
  return new LocalStore(dbPath);
}
