import { openSync, writeSync, closeSync, fstatSync, statSync, renameSync, existsSync, mkdirSync } from "fs";
import { LOG_DIR, LOG_FILE, LOG_CURRENT_LEVEL, LOG_LEVELS, LOG_MAX_FILE_BYTES, LOG_MAX_ROTATIONS } from "./config/config.js";

// ── file descriptor (persistent, O_APPEND) ────────────────────────────────

let fd = -1;

function openLog() {
  mkdirSync(LOG_DIR, { recursive: true });
  fd = openSync(LOG_FILE, "a"); // O_WRONLY | O_CREAT | O_APPEND
}

function closeLog() {
  if (fd !== -1) { try { closeSync(fd); } catch (e) { console.error("logger:close-error", e.message); } fd = -1; }
}

// Detect external rotation (another process renamed the file) by comparing
// the inode of our open fd against the inode of the current path.
function checkInode() {
  if (fd === -1) return;
  try {
    const fdIno = fstatSync(fd).ino;
    let pathIno;
    try { pathIno = statSync(LOG_FILE).ino; } catch (e) { console.error("logger:stat-error", e.message); pathIno = -1; }
    if (fdIno !== pathIno) { closeLog(); openLog(); }
  } catch (e) { console.error("logger:inode-check-error", e.message); }
}

function rotate() {
  if (fd === -1) return;
  try {
    const { size } = fstatSync(fd);
    if (size < LOG_MAX_FILE_BYTES) return;
  } catch (e) { console.error("logger:fstat-error", e.message); return; }

  closeLog();

  // Shift existing rotated files: .5 removed, .4→.5, … .1→.2
  for (let i = LOG_MAX_ROTATIONS - 1; i >= 1; i--) {
    const from = `${LOG_FILE}.${i}`;
    const to = `${LOG_FILE}.${i + 1}`;
    if (existsSync(from)) { try { renameSync(from, to); } catch (e) { console.error("logger:rename-error", e.message); } }
  }
  try { renameSync(LOG_FILE, `${LOG_FILE}.1`); } catch (e) { console.error("logger:rotate-rename-error", e.message); }

  openLog();
}

// ── write ─────────────────────────────────────────────────────────────────

function write(level, msg, extra) {
  if (LOG_LEVELS[level] < LOG_CURRENT_LEVEL) return;
  try {
    if (fd === -1) openLog();
    checkInode(); // reopen if another process rotated
    rotate();
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra }) + "\n";
    // writeSync with O_APPEND is atomic on POSIX for writes under PIPE_BUF (~4 KB)
    writeSync(fd, line);
  } catch (e) { console.error("logger:write-error", e.message); }
}

// ── cleanup on exit ───────────────────────────────────────────────────────

process.on("exit", closeLog);

// ── exported singleton ────────────────────────────────────────────────────

export const logger = {
  trace: (msg, extra = {}) => write("trace", msg, extra),
  debug: (msg, extra = {}) => write("debug", msg, extra),
  info:  (msg, extra = {}) => write("info",  msg, extra),
  warn:  (msg, extra = {}) => write("warn",  msg, extra),
  error: (msg, extra = {}) => write("error", msg, extra),
};
