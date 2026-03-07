import { logger } from "./logger.js";

/**
 * Manages Server-Sent Event (SSE) connections per project slug.
 * Shared between ui.js (local mode) and api-server.js (team mode).
 */
export class SSEBroadcaster {
  constructor(label) {
    this.label = label;
    this.clients = new Map();
    this.lastBroadcast = new Map();
  }

  /**
   * Register an SSE client for a project slug.
   * Sends the initial snapshot and returns a cleanup function.
   */
  register(slug, res, initialData) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: update\ndata: ${JSON.stringify(initialData)}\n\n`);

    if (!this.clients.has(slug)) this.clients.set(slug, new Set());
    this.clients.get(slug).add(res);

    return () => { this.clients.get(slug)?.delete(res); };
  }

  /**
   * Broadcast data to all SSE clients for a project slug.
   * @param {string} slug - Project identifier
   * @param {*} data - Data to broadcast (will be JSON-serialized)
   * @param {boolean} onlyIfChanged - Skip if data matches the last broadcast
   */
  broadcast(slug, data, onlyIfChanged = false) {
    const clients = this.clients.get(slug);
    if (!clients || clients.size === 0) return;

    const msg = `event: update\ndata: ${JSON.stringify(data)}\n\n`;
    if (onlyIfChanged && this.lastBroadcast.get(slug) === msg) return;
    this.lastBroadcast.set(slug, msg);

    for (const res of clients) {
      if (res.writableEnded) { clients.delete(res); continue; }
      try {
        res.write(msg);
      } catch (e) {
        logger.warn(`${this.label}:sse-write-error`, { slug, error: e.message });
        clients.delete(res);
      }
    }
  }

  /** Close all SSE connections and clear state. */
  closeAll() {
    for (const [, clients] of this.clients) {
      for (const res of clients) {
        try { res.end(); } catch { /* ignore */ }
      }
    }
    this.clients.clear();
    this.lastBroadcast.clear();
  }

  /** Returns an iterable of slugs that have active clients. */
  activeSlugs() {
    return this.clients.keys();
  }

  /** Returns the number of active clients for a slug. */
  clientCount(slug) {
    return this.clients.get(slug)?.size ?? 0;
  }
}
