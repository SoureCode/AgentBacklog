import { createServer } from "http";
import { API_PORT, API_HOST } from "@sourecode/agent-backlog-core/config.js";
import { NotFoundError, VersionConflictError } from "@sourecode/agent-backlog-core/db/errors.js";
import { logger } from "@sourecode/agent-backlog-core/logger.js";
import { json } from "@sourecode/agent-backlog-core/http/helpers.js";
import { authenticate } from "./auth/auth.js";
import { checkRateLimit } from "./auth/rate-limit.js";
import { getStoreForSlug } from "./store/store.js";
import { sse } from "./sse/broadcaster.js";
import { Router } from "./router.js";
import { handleHealth } from "./routes/health.js";
import { handleListProjects } from "./routes/projects/list.js";
import { handleProjectStream } from "./routes/projects/stream.js";
import { handleProjectItems } from "./routes/projects/items.js";
import { handleListItems } from "./routes/items/list.js";
import { handleCreateItem } from "./routes/items/create.js";
import { handleGetItem } from "./routes/items/get.js";
import { handleUpdateItem } from "./routes/items/update.js";
import { handleDeleteItem } from "./routes/items/delete.js";
import { handleSearchItems } from "./routes/items/search.js";
import { handleAddChecklist } from "./routes/checklists/add.js";
import { handleUpdateChecklist } from "./routes/checklists/update.js";
import { handleDeleteChecklist } from "./routes/checklists/delete.js";
import { handleAddComment } from "./routes/comments/add.js";
import { handleAddDependency } from "./routes/dependencies/add.js";
import { handleDeleteDependency } from "./routes/dependencies/delete.js";
import { handleStream } from "./routes/stream.js";

// ── Routers ───────────────────────────────────────────────────────────────

const publicRouter = new Router();
publicRouter.get("/api/health",                    handleHealth);
publicRouter.get("/api/projects",                  handleListProjects);
publicRouter.get("/api/projects/:slug/stream",     handleProjectStream);
publicRouter.get("/api/projects/:slug/items",      handleProjectItems);

const apiRouter = new Router();
apiRouter.get("/api/items",                           handleListItems);
apiRouter.post("/api/items",                          handleCreateItem);
apiRouter.get("/api/search",                          handleSearchItems);
apiRouter.get("/api/items/:id",                       handleGetItem);
apiRouter.patch("/api/items/:id",                     handleUpdateItem);
apiRouter.delete("/api/items/:id",                    handleDeleteItem);
apiRouter.post("/api/items/:id/checklist",            handleAddChecklist);
apiRouter.patch("/api/items/:id/checklist/:cid",      handleUpdateChecklist);
apiRouter.delete("/api/items/:id/checklist/:cid",     handleDeleteChecklist);
apiRouter.post("/api/items/:id/comments",             handleAddComment);
apiRouter.post("/api/items/:id/dependencies",         handleAddDependency);
apiRouter.delete("/api/items/:id/dependencies/:did",  handleDeleteDependency);
apiRouter.get("/api/stream",                          handleStream);

// ── HTTP request handler ──────────────────────────────────────────────────

async function handleRequest(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  let url;
  try {
    url = new URL(req.url, "http://localhost");
    if (await publicRouter.dispatch(req, res, url.pathname)) return;

    const projectSlug = authenticate(req);
    if (!projectSlug) {
      json(res, 401, { error: "Unauthorized — provide Authorization: Bearer <key>" });
      return;
    }

    const limited = checkRateLimit(projectSlug);
    if (limited) {
      res.setHeader("Retry-After", String(limited.retryAfter));
      json(res, 429, { error: "Too many requests. Try again later.", retryAfter: limited.retryAfter });
      return;
    }

    const store = getStoreForSlug(projectSlug);
    if (await apiRouter.dispatch(req, res, url.pathname, { store, projectSlug, url })) return;

    json(res, 404, { error: "Not found" });
  } catch (e) {
    if (e instanceof VersionConflictError) {
      logger.warn("api:version-conflict", {
        path: url?.pathname,
        id: e.currentItem?.id,
        currentVersion: e.currentItem?.version,
        yourVersion: e.expectedVersion,
      });
      json(res, 409, { error: e.message, current: e.currentItem, id: e.id, expectedVersion: e.expectedVersion });
      return;
    }
    const code = e instanceof NotFoundError ? 404 : 400;
    logger.error("api:request-error", { method: req.method, path: url?.pathname, status: code, error: e.message });
    json(res, code, { error: e.message });
  }
}

// ── serve ─────────────────────────────────────────────────────────────────

const httpServer = createServer(handleRequest);
httpServer.listen(API_PORT, API_HOST, () => {
  logger.info("api:started", { port: API_PORT, host: API_HOST });
  console.log(`Agent Backlog API server listening on http://${API_HOST}:${API_PORT}`);
});

function shutdown() {
  logger.info("api:shutdown", { port: API_PORT });
  sse.closeAll();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
