import { LocalStore } from "./local.js";
import { RemoteStore } from "./remote.js";
import { resolveProjectDb } from "../db/registry.js";
import { API_URL, API_KEY, BACKLOG_FILE } from "../config/config.js";

export function createStore({ projectRoot } = {}) {
  if (API_URL && API_KEY) {
    return new RemoteStore(API_URL, API_KEY);
  }
  const dbPath = BACKLOG_FILE ?? resolveProjectDb(projectRoot).dbPath;
  return new LocalStore(dbPath);
}
