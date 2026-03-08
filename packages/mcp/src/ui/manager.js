import { request } from "http";
import { UI_PORT } from "@sourecode/agent-backlog-core/config.js";
import { tryBecomeUILeader, releaseUILeadership, getUILeaderPort } from "@sourecode/agent-backlog-core/db/leader.js";
import { startUI, stopUI } from "@sourecode/agent-backlog-ui";
import { logger } from "@sourecode/agent-backlog-core/logger.js";


export function createUIManager() {
  let isUILeader = false;
  let uiServer = null;

  async function claimAndStartUI() {
    const result = tryBecomeUILeader(UI_PORT);
    if (!result.isLeader) return false;
    isUILeader = true;
    uiServer = await startUI(UI_PORT);

    uiServer.on("error", (err) => {
      logger.error("ui:server-error", { error: err.message });
      releaseUILeadership();
      isUILeader = false;
      uiServer = null;
    });

    uiServer.on("close", () => {
      if (isUILeader) {
        logger.warn("ui:closed-unexpectedly");
        releaseUILeadership();
        isUILeader = false;
        uiServer = null;
      }
    });

    logger.info("ui:started", { port: UI_PORT });
    return true;
  }

  function healthCheckUI(port) {
    return new Promise((resolve) => {
      const req = request({ hostname: "127.0.0.1", port, path: "/api/projects", method: "GET", timeout: 2000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  let leaderCheckInterval = null;

  async function start() {
    await claimAndStartUI();
    if (!isUILeader) {
      const lock = getUILeaderPort();
      logger.info("ui:already-running", { port: lock ?? UI_PORT });
    }

    leaderCheckInterval = setInterval(async () => {
      if (isUILeader) {
        if (!uiServer || !uiServer.listening) {
          logger.warn("ui:not-listening-restarting");
          releaseUILeadership();
          isUILeader = false;
          uiServer = null;
          await claimAndStartUI();
        }
        return;
      }

      const port = getUILeaderPort();
      if (port === null) {
        logger.info("ui:leader-gone-takeover");
        await claimAndStartUI();
        return;
      }

      const alive = await healthCheckUI(port);
      if (!alive) {
        logger.warn("ui:leader-not-responding-takeover", { port });
        await claimAndStartUI();
      }
    }, 5000);
  }

  function stop() {
    if (leaderCheckInterval) {
      clearInterval(leaderCheckInterval);
      leaderCheckInterval = null;
    }
    if (isUILeader) {
      logger.info("ui:leadership-released");
      releaseUILeadership();
      stopUI();
      isUILeader = false;
      uiServer = null;
    }
  }

  return { start, stop };
}
