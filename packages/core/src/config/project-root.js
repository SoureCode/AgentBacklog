import { isAbsolute, dirname, resolve } from "path";
import { execSync } from "child_process";

export function detectProjectRoot() {
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
    } catch (e) { console.warn("project-root:readlink-error", e.message); /* fall through */ }
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
    } catch (e) { console.warn("project-root:lsof-error", e.message); /* fall through */ }
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
  } catch (e) {
    console.warn("project-root:git-error", e.message);
    return process.cwd();
  }
}
