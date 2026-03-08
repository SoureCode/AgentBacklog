/**
 * Simple in-memory fixed-window rate limiter keyed by project slug.
 *
 * Configurable via env vars:
 *   BACKLOG_RATE_LIMIT_MAX     — max requests per window (default: 200)
 *   BACKLOG_RATE_LIMIT_WINDOW  — window size in seconds (default: 60)
 */

const MAX = parseInt(process.env.BACKLOG_RATE_LIMIT_MAX ?? "200", 10);
const WINDOW_MS = parseInt(process.env.BACKLOG_RATE_LIMIT_WINDOW ?? "60", 10) * 1000;

// Map<slug, { count, windowStart }>
const counters = new Map();

/**
 * Check whether the given slug is within the rate limit.
 * Returns null if allowed, or { retryAfter } (seconds) if exceeded.
 */
export function checkRateLimit(slug) {
  const now = Date.now();
  let entry = counters.get(slug);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    counters.set(slug, entry);
  }

  entry.count++;

  if (entry.count > MAX) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    return { retryAfter };
  }

  return null;
}
