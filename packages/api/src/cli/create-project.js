import { mkdirSync } from "fs";
import { join } from "path";
import { loadApiKeys, saveApiKeys, generateApiKey } from "../auth/auth.js";
import { API_DATA_DB_DIR } from "@sourecode/agent-backlog-core/config.js";
import { getStoreForSlug } from "../store/store.js";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: create-project <slug>");
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error(`Error: slug "${slug}" is invalid. Only lowercase letters, digits, and hyphens are allowed.`);
  process.exit(1);
}

mkdirSync(API_DATA_DB_DIR, { recursive: true });
const keys = loadApiKeys();

for (const [key, entry] of Object.entries(keys)) {
  if (entry.slug === slug) {
    console.log(`Project "${slug}" already exists.`);
    console.log(`API Key: ${key}`);
    process.exit(0);
  }
}

const apiKey = generateApiKey();
keys[apiKey] = { slug, created: new Date().toISOString() };
saveApiKeys(keys);

const store = getStoreForSlug(slug);
store.close();

console.log(`Project "${slug}" created.`);
console.log(`API Key: ${apiKey}`);
console.log(`DB: ${join(API_DATA_DB_DIR, `${slug}.backlog.db`)}`);
