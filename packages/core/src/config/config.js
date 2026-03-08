import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { detectProjectRoot } from "./project-root.js";

// ── config file loading ───────────────────────────────────────────────────
// Copilot CLI does not forward the parent shell's environment to the MCP
// server subprocess. Config files fill the gap. Three levels are supported:
//
//   Global:         ~/.config/agent-backlog/config.json   (all projects)
//   Per-repo:       {PROJECT_ROOT}/.backlog.json           (commit-safe)
//   Per-repo local: {PROJECT_ROOT}/.backlog.local.json    (add to .gitignore)
//
// Precedence (highest → lowest):
//   1. Shell environment variables    (already in process.env, never overwritten)
//   2. Per-repo local  .backlog.local.json  (secrets / personal overrides)
//   3. Per-repo        .backlog.json         (shared team config)
//   4. Global          config.json           (may supply BACKLOG_PROJECT_ROOT)
//
// Any string key/value pair is supported — not just BACKLOG_* vars.
// This module must be imported before any other local module so that all
// env-var reads at module evaluation time (logger, ui, store-remote) see the
// correct values.

// Snapshot which keys the shell actually provided.
const shellEnvKeys = new Set(Object.keys(process.env));

function applyConfigFile(filePath) {
  if (!existsSync(filePath)) return;
  try {
    const cfg = JSON.parse(readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(cfg)) {
      if (typeof value === "string" && !shellEnvKeys.has(key)) {
        process.env[key] = value;
      }
    }
  } catch (e) { console.warn("config:parse-error", filePath, e.message); }
}

// 1. Load global config (may supply BACKLOG_PROJECT_ROOT for root detection)
applyConfigFile(join(homedir(), ".config", "agent-backlog", "config.json"));

// ── project root detection ────────────────────────────────────────────────

export const PROJECT_ROOT = detectProjectRoot();

// 2. Load per-repo config (overrides global, never overrides shell env)
applyConfigFile(join(PROJECT_ROOT, ".backlog.json"));

// 3. Load per-repo local config (overrides .backlog.json, never overrides shell env)
//    Intended for secrets/personal overrides — add .backlog.local.json to .gitignore
applyConfigFile(join(PROJECT_ROOT, ".backlog.local.json"));

// ── exported config values ────────────────────────────────────────────────

export const LOG_LEVELS = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };
export const LOG_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const LOG_MAX_ROTATIONS = 5;

export const REGISTRY_DIR = join(homedir(), ".config", "agent-backlog");
export const DATA_DIR = join(REGISTRY_DIR, "data");
export const REGISTRY_PATH = join(REGISTRY_DIR, "projects.json");
export const LOCK_PATH = join(REGISTRY_DIR, "ui.lock");

export const LOG_DIR = process.env.BACKLOG_LOG_DIR
  ?? join(homedir(), ".config", "agent-backlog", "logs");
export const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase();
export const LOG_FILE = join(LOG_DIR, "agent-backlog.log");
export const LOG_CURRENT_LEVEL = LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.info;

export const API_URL = process.env.BACKLOG_API_URL ?? null;
export const API_KEY = process.env.BACKLOG_API_KEY ?? null;
export const BACKLOG_FILE = process.env.BACKLOG_FILE ?? null;
export const REQUEST_TIMEOUT_MS = parseInt(process.env.BACKLOG_REQUEST_TIMEOUT_MS ?? "10000", 10);

export const UI_PORT = parseInt(process.env.BACKLOG_UI_PORT ?? "3456", 10);
export const UI_HOST = process.env.BACKLOG_UI_HOST ?? "0.0.0.0";

export const API_PORT = parseInt(process.env.BACKLOG_API_PORT ?? "4000", 10);
export const API_HOST = process.env.BACKLOG_API_HOST ?? "127.0.0.1";
export const API_DATA_DIR = process.env.BACKLOG_API_DATA_DIR
  ?? join(homedir(), ".config", "agent-backlog-server");
export const API_DATA_KEYS_PATH = join(API_DATA_DIR, "api-keys.json");
export const API_DATA_DB_DIR = join(API_DATA_DIR, "data");
