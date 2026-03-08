import { existsSync, readFileSync, mkdirSync, unlinkSync, openSync, writeFileSync, closeSync, constants as fsConstants } from "fs";
import { REGISTRY_DIR, LOCK_PATH } from "../config/config.js";
import { now } from "./queries.js";
import { logger } from "../logger.js";

// ── UI leader election ────────────────────────────────────────────────────

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLock() {
  if (!existsSync(LOCK_PATH)) return null;
  try {
    return JSON.parse(readFileSync(LOCK_PATH, "utf8"));
  } catch (e) {
    logger.warn("leader:lock-parse-error", { error: e.message });
    return null;
  }
}

function removeLock() {
  try { unlinkSync(LOCK_PATH); } catch (e) { logger.warn("leader:unlink-error", { error: e.message }); }
}

export function tryBecomeUILeader(port) {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  const data = JSON.stringify({ pid: process.pid, port, started: now() }) + "\n";

  // Attempt atomic creation with O_EXCL — fails if file already exists
  try {
    const fd = openSync(LOCK_PATH, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL);
    writeFileSync(fd, data, "utf8");
    closeSync(fd);
    return { isLeader: true, port };
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }

  // Lock file exists — check if the holder is still alive
  const lock = readLock();
  if (lock && isProcessAlive(lock.pid)) {
    return { isLeader: false, port: lock.port };
  }

  // Stale lock — remove and retry atomically
  try { unlinkSync(LOCK_PATH); } catch (e) { logger.warn("leader:unlink-error", { error: e.message }); }
  try {
    const fd = openSync(LOCK_PATH, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL);
    writeFileSync(fd, data, "utf8");
    closeSync(fd);
    return { isLeader: true, port };
  } catch (e) {
    if (e.code === "EEXIST") {
      // Another process claimed it between our unlink and open
      const newLock = readLock();
      return { isLeader: false, port: newLock?.port ?? port };
    }
    throw e;
  }
}

export function releaseUILeadership() {
  const lock = readLock();
  if (lock && lock.pid === process.pid) {
    removeLock();
  }
}

export function getUILeaderPort() {
  const lock = readLock();
  if (lock && isProcessAlive(lock.pid)) return lock.port;
  return null;
}
