import { openSync, writeSync, closeSync, fstatSync, statSync, renameSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── config ────────────────────────────────────────────────────────────────

const LEVELS = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATIONS = 5;

const LOG_DIR = process.env.BACKLOG_LOG_DIR
  ?? join(homedir(), ".config", "agent-backlog", "logs");
const LOG_FILE = join(LOG_DIR, "agent-backlog.log");

const envLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const currentLevel = LEVELS[envLevel] ?? LEVELS.info;

// ── file descriptor (persistent, O_APPEND) ────────────────────────────────

let fd = -1;

function openLog() {
  mkdirSync(LOG_DIR, { recursive: true });
  fd = openSync(LOG_FILE, "a"); // O_WRONLY | O_CREAT | O_APPEND
}

function closeLog() {
  if (fd !== -1) { try { closeSync(fd); } catch { /* ignore */ } fd = -1; }
}

// Detect external rotation (another process renamed the file) by comparing
// the inode of our open fd against the inode of the current path.
function checkInode() {
  if (fd === -1) return;
  try {
    const fdIno = fstatSync(fd).ino;
    let pathIno;
    try { pathIno = statSync(LOG_FILE).ino; } catch { pathIno = -1; }
    if (fdIno !== pathIno) { closeLog(); openLog(); }
  } catch { /* ignore */ }
}

function rotate() {
  if (fd === -1) return;
  try {
    const { size } = fstatSync(fd);
    if (size < MAX_FILE_BYTES) return;
  } catch { return; }

  closeLog();

  // Shift existing rotated files: .5 removed, .4→.5, … .1→.2
  for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
    const from = `${LOG_FILE}.${i}`;
    const to = `${LOG_FILE}.${i + 1}`;
    if (existsSync(from)) { try { renameSync(from, to); } catch { /* ignore */ } }
  }
  try { renameSync(LOG_FILE, `${LOG_FILE}.1`); } catch { /* ignore */ }

  openLog();
}

// ── write ─────────────────────────────────────────────────────────────────

function write(level, msg, extra) {
  if (LEVELS[level] < currentLevel) return;
  try {
    if (fd === -1) openLog();
    checkInode(); // reopen if another process rotated
    rotate();
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra }) + "\n";
    // writeSync with O_APPEND is atomic on POSIX for writes under PIPE_BUF (~4 KB)
    writeSync(fd, line);
  } catch { /* best-effort: never crash the server because of logging */ }
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
