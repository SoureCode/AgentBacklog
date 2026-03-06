import { existsSync, readFileSync } from "fs";
import { join, dirname, resolve, isAbsolute } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

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
  } catch { /* malformed config — silently ignore */ }
}

// 1. Load global config (may supply BACKLOG_PROJECT_ROOT for root detection)
applyConfigFile(join(homedir(), ".config", "agent-backlog", "config.json"));

// ── project root detection ────────────────────────────────────────────────

function detectProjectRoot() {
  if (process.env.BACKLOG_PROJECT_ROOT) return process.env.BACKLOG_PROJECT_ROOT;

  // When launched by Copilot CLI the server's cwd is the plugin install dir.
  // Reading the parent process cwd gives us the CLI's working directory.
  if (process.platform === "linux") {
    try {
      const parentCwd = execSync(`readlink /proc/${process.ppid}/cwd`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (parentCwd && parentCwd !== process.cwd()) return parentCwd;
    } catch { /* fall through */ }
  }

  if (process.platform === "darwin") {
    try {
      const out = execSync(`lsof -a -p ${process.ppid} -d cwd -Fn`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      const line = out.split("\n").find(l => l.startsWith("n"));
      if (line) {
        const parentCwd = line.slice(1);
        if (parentCwd && parentCwd !== process.cwd()) return parentCwd;
      }
    } catch { /* fall through */ }
  }

  // Use --git-common-dir to resolve to the main repo root even in worktrees.
  // Regular repo: returns ".git" (relative) → resolve + dirname = repo root
  // Worktree: returns "/path/to/main-repo/.git" (absolute) → dirname = main repo root
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (isAbsolute(gitCommonDir)) {
      return dirname(gitCommonDir);
    }
    return dirname(resolve(process.cwd(), gitCommonDir));
  } catch {
    return process.cwd();
  }
}

export const PROJECT_ROOT = detectProjectRoot();

// 2. Load per-repo config (overrides global, never overrides shell env)
applyConfigFile(join(PROJECT_ROOT, ".backlog.json"));

// 3. Load per-repo local config (overrides .backlog.json, never overrides shell env)
//    Intended for secrets/personal overrides — add .backlog.local.json to .gitignore
applyConfigFile(join(PROJECT_ROOT, ".backlog.local.json"));
