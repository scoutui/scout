import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Renames the checked-out branch of the repository at `dir` to `main` and gives it an `origin` remote holding that history,
 * whose default branch is `main` (so a clone of it checks out `main`), with `origin/HEAD` pointing at `main`, as a fresh clone
 * has. Returns the remote's folder for the caller to remove.
 */
export function pushToOrigin(dir: string): string {
  const origin = realpathSync(mkdtempSync(join(tmpdir(), "cc-origin-")));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
  git(origin, "init", "-q", "--bare", "--initial-branch=main");
  git(dir, "branch", "-M", "main");
  git(dir, "remote", "add", "origin", origin);
  git(dir, "push", "-q", "origin", "main");
  git(dir, "remote", "set-head", "origin", "main");
  return origin;
}
