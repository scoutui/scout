import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFailed } from "../scan/meta.js";
import { runGit } from "../util/git.js";

const HOOKS_OFF = ["-c", "core.hooksPath=/dev/null"];

/**
 * Adds a worktree detached at `tip` as `checkout`, inside a new run folder under the OS temp folder, after pruning
 * worktrees whose folders are gone. `runDir` is the run folder's real path.
 */
export async function createWorktree(cwd: string, tip: string): Promise<{ runDir: string; checkout: string }> {
  const prune = await runGit(cwd, ["worktree", "prune"]);
  if (!prune.ok) throw gitFailed(cwd, prune.detail);
  const runDir = await realpath(await mkdtemp(join(tmpdir(), "scout-backfill-")));
  const checkout = join(runDir, "checkout");
  const add = await runGit(cwd, [...HOOKS_OFF, "worktree", "add", "--detach", checkout, tip]);
  if (!add.ok) {
    removeWorktreeSync(cwd, runDir);
    throw gitFailed(cwd, add.detail);
  }
  return { runDir, checkout };
}

/** Moves `checkout` to `commit`, dropping changed and untracked files but keeping ignored ones such as `node_modules`. */
export async function checkoutCommit(checkout: string, commit: string): Promise<void> {
  const move = await runGit(checkout, [...HOOKS_OFF, "checkout", "-f", "--detach", commit]);
  if (!move.ok) throw gitFailed(checkout, move.detail);
  const clean = await runGit(checkout, ["clean", "-fd"]);
  if (!clean.ok) throw gitFailed(checkout, clean.detail);
}

/** Removes the worktree `createWorktree` added and its run folder, then prunes it from `cwd`'s worktree list. */
export function removeWorktreeSync(cwd: string, runDir: string): void {
  runGitIgnoringFailure(cwd, ["worktree", "remove", "--force", join(runDir, "checkout")]);
  rmSync(runDir, { recursive: true, force: true, maxRetries: 5 });
  runGitIgnoringFailure(cwd, ["worktree", "prune"]);
}

function runGitIgnoringFailure(cwd: string, args: string[]): void {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
  } catch {}
}
