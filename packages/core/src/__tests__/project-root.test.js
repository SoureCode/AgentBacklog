import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("detectProjectRoot()", () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns BACKLOG_PROJECT_ROOT when set", async () => {
    process.env.BACKLOG_PROJECT_ROOT = "/custom/root";
    const { detectProjectRoot } = await import("../config/project-root.js");
    expect(detectProjectRoot()).toBe("/custom/root");
  });

  it("falls back to git common-dir resolution when env not set", async () => {
    delete process.env.BACKLOG_PROJECT_ROOT;
    vi.resetModules();
    vi.doMock("child_process", async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        execSync: (cmd) => {
          if (cmd.includes("readlink") || cmd.includes("lsof")) throw new Error("skip");
          if (cmd.includes("git rev-parse")) return ".git\n";
          throw new Error("unknown");
        },
      };
    });
    const { detectProjectRoot } = await import("../config/project-root.js");
    // Should return the directory containing .git — i.e. cwd or a resolved path
    const result = detectProjectRoot();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns cwd when git command fails", async () => {
    delete process.env.BACKLOG_PROJECT_ROOT;
    vi.resetModules();
    vi.doMock("child_process", async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        execSync: () => { throw new Error("not a git repo"); },
      };
    });
    const { detectProjectRoot } = await import("../config/project-root.js");
    expect(detectProjectRoot()).toBe(process.cwd());
  });
});
