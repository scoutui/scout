import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "../cli/parse.js";
import { gitFailed } from "../scan/meta.js";
import { runGit } from "../util/git.js";
import { type ChainCommit, commitLabel } from "./commits.js";

const HOOKS_OFF = ["-c", "core.hooksPath=/dev/null"];

/** Adds a worktree detached at `tip` as `<runDir>/checkout`, after pruning worktrees whose folders are gone. Returns its path. */
export async function createWorktree(cwd: string, runDir: string, tip: ChainCommit): Promise<string> {
  const prune = await runGit(cwd, ["worktree", "prune"]);
  if (!prune.ok) throw gitFailed(cwd, prune.detail);
  const checkout = join(runDir, "checkout");
  const add = await runGit(cwd, [...HOOKS_OFF, "worktree", "add", "--detach", checkout, tip.commit]);
  if (!add.ok) throw checkoutFailed(tip, add.detail);
  return checkout;
}

/** Moves `checkout` to `entry`'s commit, dropping changed and untracked files but keeping ignored ones such as `node_modules`. */
export async function checkoutCommit(checkout: string, entry: ChainCommit): Promise<void> {
  const move = await runGit(checkout, [...HOOKS_OFF, "checkout", "-f", "--detach", entry.commit]);
  if (!move.ok) throw checkoutFailed(entry, move.detail);
  const clean = await runGit(checkout, ["clean", "-fd"]);
  if (!clean.ok) throw checkoutFailed(entry, clean.detail);
}

/** Removes the worktree `createWorktree` added and its run folder, then prunes it from `cwd`'s worktree list. */
export function removeWorktreeSync(cwd: string, runDir: string): void {
  runGitIgnoringFailure(cwd, ["worktree", "remove", "--force", join(runDir, "checkout")]);
  rmSync(runDir, { recursive: true, force: true, maxRetries: 5 });
  runGitIgnoringFailure(cwd, ["worktree", "prune"]);
}

/** The line for git failing to check out `entry`, with git's own message as its detail. */
function checkoutFailed(entry: ChainCommit, detail: string): CliError {
  return new CliError(`Couldn't check out ${commitLabel(entry)} in a temporary folder. Run scout backfill --debug to see git's output.`, 1, {
    detail,
  });
}

function runGitIgnoringFailure(cwd: string, args: string[]): void {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
  } catch {}
}
