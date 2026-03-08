import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync } from "fs";

let logDir;
let logger;

describe("logger — basic writes", () => {
  beforeAll(async () => {
    logDir = mkdtempSync(join(tmpdir(), "backlog-logger-test-"));
    vi.resetModules();
    process.env.BACKLOG_LOG_DIR = logDir;
    process.env.LOG_LEVEL = "trace";
    ({ logger } = await import("../logger.js"));
  });

  afterAll(() => {
    delete process.env.BACKLOG_LOG_DIR;
    delete process.env.LOG_LEVEL;
    try { rmSync(logDir, { recursive: true, force: true }); } catch (_) {}
  });

  it("logger.info writes a JSON line to the log file", () => {
    logger.info("test-info-message", { key: "value" });
    const logFile = join(logDir, "agent-backlog.log");
    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, "utf8");
    expect(content).toContain("test-info-message");
    expect(content).toContain('"level":"info"');
  });

  it("logger.warn writes a JSON line", () => {
    logger.warn("test-warn-message");
    const content = readFileSync(join(logDir, "agent-backlog.log"), "utf8");
    expect(content).toContain("test-warn-message");
  });

  it("logger.error writes a JSON line", () => {
    logger.error("test-error-message");
    const content = readFileSync(join(logDir, "agent-backlog.log"), "utf8");
    expect(content).toContain("test-error-message");
  });

  it("logger.debug writes a JSON line (level=trace allows it)", () => {
    logger.debug("test-debug-message");
    const content = readFileSync(join(logDir, "agent-backlog.log"), "utf8");
    expect(content).toContain("test-debug-message");
  });

  it("logger.trace writes a JSON line (level=trace allows it)", () => {
    logger.trace("test-trace-message");
    const content = readFileSync(join(logDir, "agent-backlog.log"), "utf8");
    expect(content).toContain("test-trace-message");
  });
});

describe("logger — inode detection (checkInode)", () => {
  it("reopens log file when inode changes (external rotation simulation)", async () => {
    const inodeDir = mkdtempSync(join(tmpdir(), "backlog-logger-inode-"));
    vi.resetModules();
    process.env.BACKLOG_LOG_DIR = inodeDir;
    process.env.LOG_LEVEL = "info";

    const { logger: inodeLogger } = await import("../logger.js");

    const logFile = join(inodeDir, "agent-backlog.log");
    inodeLogger.info("before-rotation");
    expect(existsSync(logFile)).toBe(true);

    // Simulate external rotation: rename the current log file
    const { renameSync } = await import("fs");
    renameSync(logFile, `${logFile}.old`);

    // Next write should detect inode mismatch and reopen (creates new file)
    inodeLogger.info("after-rotation");
    expect(existsSync(logFile)).toBe(true);

    delete process.env.BACKLOG_LOG_DIR;
    delete process.env.LOG_LEVEL;
    try { rmSync(inodeDir, { recursive: true, force: true }); } catch (_) {}
  });
});

describe("logger — rotation (rotate)", () => {
  it("rotates log file when it exceeds LOG_MAX_FILE_BYTES", async () => {
    const rotDir = mkdtempSync(join(tmpdir(), "backlog-logger-rotate-"));
    vi.resetModules();
    process.env.BACKLOG_LOG_DIR = rotDir;
    process.env.LOG_LEVEL = "info";

    // Mock config to set a 1-byte max so rotation triggers immediately
    vi.doMock("../config/config.js", async (importOriginal) => {
      const real = await importOriginal();
      return { ...real, LOG_MAX_FILE_BYTES: 1 };
    });

    const { logger: rotLogger } = await import("../logger.js");
    const logFile = join(rotDir, "agent-backlog.log");

    rotLogger.info("first-write-opens-file");
    expect(existsSync(logFile)).toBe(true);

    // Second write: file is now >= 1 byte, so rotation triggers
    rotLogger.info("second-write-triggers-rotation");

    expect(existsSync(`${logFile}.1`)).toBe(true);

    delete process.env.BACKLOG_LOG_DIR;
    delete process.env.LOG_LEVEL;
    vi.restoreAllMocks();
    try { rmSync(rotDir, { recursive: true, force: true }); } catch (_) {}
  });
});

describe("logger — checkInode fstatSync error (outer catch)", () => {
  it("handles fstatSync throwing in checkInode", async () => {
    const catchDir = mkdtempSync(join(tmpdir(), "backlog-logger-catch-"));
    vi.resetModules();
    process.env.BACKLOG_LOG_DIR = catchDir;
    process.env.LOG_LEVEL = "info";

    let fstatCallCount = 0;
    vi.doMock("fs", async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        fstatSync: (...args) => {
          fstatCallCount++;
          // write() calls checkInode then rotate, each calls fstatSync once.
          // First write: checkInode=call1, rotate=call2
          // Second write: checkInode=call3 <- throw here to hit outer catch
          if (fstatCallCount === 3) throw new Error("mock-fstat-failure");
          return real.fstatSync(...args);
        },
      };
    });

    const { logger: catchLogger } = await import("../logger.js");
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    catchLogger.info("first-opens-file");
    // second write: checkInode's fstatSync will throw, triggering outer catch
    catchLogger.info("second-triggers-inode-check");

    expect(stderrSpy).toHaveBeenCalledWith("logger:inode-check-error", "mock-fstat-failure");

    stderrSpy.mockRestore();
    delete process.env.BACKLOG_LOG_DIR;
    delete process.env.LOG_LEVEL;
    vi.restoreAllMocks();
    try { rmSync(catchDir, { recursive: true, force: true }); } catch (_) {}
  });
});

describe("logger — rotate fstatSync error (rotate catch)", () => {
  it("handles fstatSync throwing in rotate", async () => {
    const rotCatchDir = mkdtempSync(join(tmpdir(), "backlog-logger-rotcatch-"));
    vi.resetModules();
    process.env.BACKLOG_LOG_DIR = rotCatchDir;
    process.env.LOG_LEVEL = "info";

    let fstatCallCount = 0;
    vi.doMock("fs", async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        fstatSync: (...args) => {
          fstatCallCount++;
          // write() calls checkInode then rotate, each calls fstatSync once.
          // First write: checkInode=call1, rotate=call2
          // Second write: checkInode=call3, rotate=call4 <- throw here
          if (fstatCallCount === 4) throw new Error("mock-rotate-fstat-failure");
          return real.fstatSync(...args);
        },
      };
    });

    const { logger: rotCatchLogger } = await import("../logger.js");
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    rotCatchLogger.info("first-opens-file");
    // second write triggers rotate, which calls fstatSync and throws
    rotCatchLogger.info("second-triggers-rotate-error");

    expect(stderrSpy).toHaveBeenCalledWith("logger:fstat-error", "mock-rotate-fstat-failure");

    stderrSpy.mockRestore();
    delete process.env.BACKLOG_LOG_DIR;
    delete process.env.LOG_LEVEL;
    vi.restoreAllMocks();
    try { rmSync(rotCatchDir, { recursive: true, force: true }); } catch (_) {}
  });
});

describe("logger — write error catch", () => {
  it("logs to stderr instead of throwing when writeSync fails", async () => {
    const errDir = mkdtempSync(join(tmpdir(), "backlog-logger-err-"));
    vi.resetModules();
    process.env.BACKLOG_LOG_DIR = errDir;
    process.env.LOG_LEVEL = "info";

    // Mock fs to make writeSync throw
    vi.doMock("fs", async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        writeSync: () => { throw new Error("mock-write-failure"); },
      };
    });

    const { logger: errLogger } = await import("../logger.js");
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Should not throw; error is caught and logged to stderr
    expect(() => errLogger.info("write-will-fail")).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledWith("logger:write-error", "mock-write-failure");

    stderrSpy.mockRestore();
    delete process.env.BACKLOG_LOG_DIR;
    delete process.env.LOG_LEVEL;
    vi.restoreAllMocks();
    try { rmSync(errDir, { recursive: true, force: true }); } catch (_) {}
  });
});
