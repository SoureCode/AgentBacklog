import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { logger } from "@sourecode/agent-backlog-core/logger.js";
import { API_DATA_DIR, API_DATA_KEYS_PATH } from "@sourecode/agent-backlog-core/config.js";

export function hashKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

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
  const keyHash = hashKey(key);
  const keyHashBuf = Buffer.from(keyHash, "hex");

  const keys = loadApiKeys();
  let migrated = false;

  for (const [stored, entry] of Object.entries(keys)) {
    // Auto-migrate plaintext keys (they start with "sk-proj-")
    if (stored.startsWith("sk-proj-")) {
      const storedHash = hashKey(stored);
      delete keys[stored];
      keys[storedHash] = entry;
      migrated = true;
      logger.info("api-keys:migrated-plaintext-key", { slug: entry.slug });
      if (storedHash === keyHash) return entry.slug;
      continue;
    }

    // Constant-time comparison of hashes
    try {
      const storedBuf = Buffer.from(stored, "hex");
      if (storedBuf.length === keyHashBuf.length && timingSafeEqual(storedBuf, keyHashBuf)) {
        if (migrated) saveApiKeys(keys);
        return entry.slug;
      }
    } catch {
      // stored value is not valid hex — skip
    }
  }

  if (migrated) saveApiKeys(keys);
  return null;
}
