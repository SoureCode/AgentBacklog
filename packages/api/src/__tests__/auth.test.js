import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hashKey, generateApiKey } from "../auth/auth.js";

// ---- hashKey ----
describe("hashKey()", () => {
  it("returns a 64-char hex string", () => {
    const h = hashKey("sk-proj-abc123");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(hashKey("foo")).toBe(hashKey("foo"));
  });

  it("is different for different inputs", () => {
    expect(hashKey("a")).not.toBe(hashKey("b"));
  });
});

// ---- generateApiKey ----
describe("generateApiKey()", () => {
  it("starts with sk-proj-", () => {
    expect(generateApiKey()).toMatch(/^sk-proj-/);
  });

  it("generates unique keys", () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });

  it("has 56 chars total (sk-proj- + 48 hex chars)", () => {
    expect(generateApiKey()).toHaveLength(56);
  });
});

// ---- checkRateLimit ----
// Import lazily so we can control Date.now() before the module's WINDOW_MS is read.
// Rate limit state is module-level so we isolate by re-importing fresh per suite.
describe("checkRateLimit()", () => {
  let checkRateLimit;
  let nowMs;

  beforeEach(async () => {
    nowMs = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);

    // Reset module registry so counters Map is fresh
    vi.resetModules();
    ({ checkRateLimit } = await import("../auth/rate-limit.js"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when under the limit", () => {
    expect(checkRateLimit("proj")).toBeNull();
  });

  it("returns retryAfter object when limit exceeded", () => {
    const max = parseInt(process.env.BACKLOG_RATE_LIMIT_MAX ?? "200", 10);
    for (let i = 0; i < max; i++) checkRateLimit("proj");
    const result = checkRateLimit("proj");
    expect(result).not.toBeNull();
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("resets counter after window expires", () => {
    const max = parseInt(process.env.BACKLOG_RATE_LIMIT_MAX ?? "200", 10);
    const windowMs = parseInt(process.env.BACKLOG_RATE_LIMIT_WINDOW ?? "60", 10) * 1000;
    for (let i = 0; i < max + 1; i++) checkRateLimit("proj");
    // Advance time past window
    nowMs += windowMs + 1;
    expect(checkRateLimit("proj")).toBeNull();
  });

  it("isolates counters per slug", () => {
    expect(checkRateLimit("a")).toBeNull();
    expect(checkRateLimit("b")).toBeNull();
  });
});
