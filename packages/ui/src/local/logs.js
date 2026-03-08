import { existsSync, readSync, openSync, fstatSync, closeSync, watch } from "fs";
import { join } from "path";
import { logger } from "@sourecode/agent-backlog-core/logger.js";
import { LOG_DIR } from "@sourecode/agent-backlog-core/config.js";

export const LOG_FILE = join(LOG_DIR, "agent-backlog.log");
const LOG_TAIL_CHUNK = 128 * 1024; // 128 KB read from end

export function readLastLogLines(n, skip = 0) {
  if (!existsSync(LOG_FILE)) return [];
  let fd;
  try {
    fd = openSync(LOG_FILE, "r");
    const { size } = fstatSync(fd);
    const readSize = Math.min(size, LOG_TAIL_CHUNK);
    const buf = Buffer.allocUnsafe(readSize);
    readSync(fd, buf, 0, readSize, size - readSize);
    const text = buf.toString("utf8");
    const lines = text.split("\n").filter(l => l.trim());
    const end = skip > 0 ? -skip : undefined;
    const tail = lines.slice(-(n + skip), end);
    return tail.map(l => { try { return JSON.parse(l); } catch (e) { logger.warn("logs:json-parse-error", { error: e.message }); return { msg: l }; } });
  } catch (e) { logger.warn("logs:read-error", { error: e.message }); return []; }
  finally { if (fd != null) try { closeSync(fd); } catch (e) { logger.warn("logs:close-error", { error: e.message }); } }
}

export function streamLogTail(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  if (!existsSync(LOG_FILE)) { res.end(); return; }

  // Track file position at current end
  let fd;
  try { fd = openSync(LOG_FILE, "r"); } catch (e) { logger.warn("logs:open-error", { error: e.message }); res.end(); return; }
  let pos;
  try { pos = fstatSync(fd).size; } catch (e) { logger.warn("logs:fstat-error", { error: e.message }); closeSync(fd); res.end(); return; }
  let remainder = "";

  function readNew() {
    try {
      const { size } = fstatSync(fd);
      if (size < pos) { pos = size; remainder = ""; return; } // truncated/rotated
      if (size === pos) return;
      const chunk = Buffer.allocUnsafe(size - pos);
      const bytesRead = readSync(fd, chunk, 0, chunk.length, pos);
      pos += bytesRead;
      remainder += chunk.slice(0, bytesRead).toString("utf8");
      const lines = remainder.split("\n");
      remainder = lines.pop(); // keep incomplete last line
      for (const line of lines) {
        if (!line.trim()) continue;
        let entry;
        try { entry = JSON.parse(line); } catch (e) { logger.warn("logs:tail-json-parse-error", { error: e.message }); entry = { msg: line }; }
        res.write(`event: entry\ndata: ${JSON.stringify(entry)}\n\n`);
      }
    } catch (e) { logger.warn("logs:tail-read-error", { error: e.message }); }
  }

  let watcher;
  try {
    watcher = watch(LOG_FILE, () => readNew());
  } catch (e) {
    logger.warn("logs:watch-error", { error: e.message });
    // fs.watch unavailable; fall back to polling
    watcher = setInterval(readNew, 1000);
  }

  const stop = typeof watcher.close === "function"
    ? () => watcher.close()
    : () => clearInterval(watcher);

  res.on("close", () => {
    stop();
    try { closeSync(fd); } catch (e) { logger.warn("logs:stream-close-error", { error: e.message }); }
  });
}
