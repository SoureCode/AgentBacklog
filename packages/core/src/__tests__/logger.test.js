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
  it("handles fstatSync throwing in checkInode without propagating", async () => {
    const catchDir = mkdtempSync(join(tmpdir(), "backlog-logger-catch-"));
    vi.resetModules();
    process.env.BACKLOG_LOG_DIR = catchDir;
    process.env.LOG_LEVEL = "info";

    // After the first write opens the file, make fstatSync always throw so
    // the next write's checkInode hits the outer catch block.
    let firstWriteDone = false;
    vi.doMock("fs", async (importOriginal) => {
      const real = await importOriginal();
      return {
        ...real,
        fstatSync: (...args) => {
          if (firstWriteDone) throw new Error("mock-fstat-failure");
          return real.fstatSync(...args);
        },
        writeSync: (...args) => {
          const result = real.writeSync(...args);
          firstWriteDone = true;
          return result;
        },
      };
    });

    const { logger: catchLogger } = await import("../logger.js");
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    catchLogger.info("first-opens-file");
    catchLogger.info("second-triggers-inode-error");

    expect(stderrSpy).toHaveBeenCalledWith("logger:inode-check-error", "mock-fstat-failure");

    stderrSpy.mockRestore();
    delete process.env.BACKLOG_LOG_DIR;
    delete process.env.LOG_LEVEL;
    vi.restoreAllMocks();
    try { rmSync(catchDir, { recursive: true, force: true }); } catch (_) {}
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
