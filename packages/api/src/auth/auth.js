import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import { logger } from "@sourecode/agent-backlog-core/logger.js";
import { API_DATA_DIR, API_DATA_KEYS_PATH } from "@sourecode/agent-backlog-core/config.js";

export function loadApiKeys() {
  if (!existsSync(API_DATA_KEYS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(API_DATA_KEYS_PATH, "utf8"));
  } catch (e) {
    logger.warn("api-keys:parse-error", { error: e.message });
    return {};
  }
}

export function saveApiKeys(keys) {
  mkdirSync(API_DATA_DIR, { recursive: true });
  writeFileSync(API_DATA_KEYS_PATH, JSON.stringify(keys, null, 2) + "\n", "utf8");
}

export function generateApiKey() {
  return "sk-proj-" + randomBytes(24).toString("hex");
}

export function authenticate(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const key = auth.slice(7);
  const keys = loadApiKeys();
  const entry = keys[key];
  if (!entry) return null;
  return entry.slug;
}
