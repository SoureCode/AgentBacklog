import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hashKey, generateApiKey, authenticate } from "../auth/auth.js";

// ---- hashKey ----
describe("hashKey()", () => {
  it("returns a 64-char hex string", () => {
    const h = hashKey("sk-proj-abc123");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
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

  it("exhausting limit for one slug does not affect another", () => {
    const max = parseInt(process.env.BACKLOG_RATE_LIMIT_MAX ?? "200", 10);
    for (let i = 0; i <= max; i++) checkRateLimit("a");
    // "a" is now rate-limited, "b" should still be allowed
    expect(checkRateLimit("a")).not.toBeNull();
    expect(checkRateLimit("b")).toBeNull();
  });
});

// ---- loadApiKeys ----
describe("loadApiKeys()", () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns {} when keys file does not exist", async () => {
    vi.doMock("fs", async (importOriginal) => {
      const real = await importOriginal();
      return { ...real, existsSync: () => false };
    });
    const { loadApiKeys } = await import("../auth/auth.js");
    expect(loadApiKeys()).toEqual({});
  });

  it("returns {} when keys file has invalid JSON", async () => {
    vi.doMock("fs", async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        existsSync: () => true,
        readFileSync: () => "not-json{{{",
      };
    });
    const { loadApiKeys } = await import("../auth/auth.js");
    expect(loadApiKeys()).toEqual({});
  });
});

// ---- authenticate ----
describe("authenticate()", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no Authorization header", async () => {
    const { authenticate } = await import("../auth/auth.js");
    expect(authenticate({ headers: {} })).toBeNull();
  });

  it("returns null when header is not Bearer", async () => {
    const { authenticate } = await import("../auth/auth.js");
    expect(authenticate({ headers: { authorization: "Basic abc" } })).toBeNull();
  });

  it("returns null when key not in keys file", async () => {
    vi.doMock("fs", async (importOriginal) => {
      const real = await importOriginal();
      return { ...real, existsSync: () => true, readFileSync: () => JSON.stringify({}) };
    });
    const { authenticate } = await import("../auth/auth.js");
    expect(authenticate({ headers: { authorization: "Bearer sk-proj-unknown" } })).toBeNull();
  });

  it("returns slug for matching hashed key", async () => {
    vi.doMock("fs", async (importOriginal) => {
      const real = await importOriginal();
      const { createHash } = await import("crypto");
      const key = "sk-proj-testkey";
      const hash = createHash("sha256").update(key).digest("hex");
      const keys = { [hash]: { slug: "my-project", created: "2024-01-01" } };
      return {
        ...real,
        existsSync: () => true,
        readFileSync: () => JSON.stringify(keys),
        mkdirSync: real.mkdirSync,
        writeFileSync: vi.fn(),
      };
    });
    const { authenticate } = await import("../auth/auth.js");
    const slug = authenticate({ headers: { authorization: "Bearer sk-proj-testkey" } });
    expect(slug).toBe("my-project");
  });

  it("migrates a non-matching plaintext key and continues searching", async () => {
    const writeMock = vi.fn();
    vi.doMock("fs", async (importOriginal) => {
      const real = await importOriginal();
      const otherPlaintextKey = "sk-proj-otherkey";
      const targetKey = "sk-proj-targetkey";
      const { createHash } = await import("crypto");
      const targetHash = createHash("sha256").update(targetKey).digest("hex");
      // Two entries: one plaintext non-matching, one already-hashed matching
      const keys = {
        [otherPlaintextKey]: { slug: "other-project", created: "2024-01-01" },
        [targetHash]: { slug: "target-project", created: "2024-01-01" },
      };
      return {
        ...real,
        existsSync: () => true,
        readFileSync: () => JSON.stringify(keys),
        mkdirSync: vi.fn(),
        writeFileSync: writeMock,
      };
    });
    const { authenticate } = await import("../auth/auth.js");
    const slug = authenticate({ headers: { authorization: "Bearer sk-proj-targetkey" } });
    expect(slug).toBe("target-project");
    // writeFileSync should have been called due to migration of otherPlaintextKey
    expect(writeMock).toHaveBeenCalled();
  });

  it("auto-migrates plaintext key and returns slug", async () => {
    const writeMock = vi.fn();
    vi.doMock("fs", async (importOriginal) => {
      const real = await importOriginal();
      const key = "sk-proj-plaintextkey";
      const keys = { [key]: { slug: "migrated-project", created: "2024-01-01" } };
      return {
        ...real,
        existsSync: () => true,
        readFileSync: () => JSON.stringify(keys),
        mkdirSync: vi.fn(),
        writeFileSync: writeMock,
      };
    });
    const { authenticate } = await import("../auth/auth.js");
    const slug = authenticate({ headers: { authorization: "Bearer sk-proj-plaintextkey" } });
    expect(slug).toBe("migrated-project");
  });
});
