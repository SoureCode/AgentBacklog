import { loadApiKeys } from "./auth.js";

export function projectExists(slug) {
  const keys = loadApiKeys();
  return Object.values(keys).some((entry) => entry.slug === slug);
}
