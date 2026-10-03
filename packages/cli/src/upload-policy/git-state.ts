import { relative, resolve } from "node:path";
import { gitFailed, type Checkout } from "../scan/meta.js";
import { firstParentPosition, hasCommit, localChanges, recordedDefaultBranch, severalRemotesLine } from "../util/git.js";

/** The branch an upload follows, and where the scanned commit sits on that branch's first-parent chain, counting from 1. */
export type TrackedBranch = { branch: string; position: number };

export type GitState = { kind: "ok"; tracked: TrackedBranch } | { kind: "refused"; message: string };

const REFUSED = "Couldn't upload the scan:";

function refused(reason: string): { kind: "refused"; message: string } {
  return { kind: "refused", message: `${REFUSED} ${reason}` };
}

/**
 * Whether the checkout can be uploaded: it has the remote the dashboard follows and its full history, and its commit is on the
 * tracked branch's first-parent chain. The tracked branch is `branch` from the config, else the
 * one the clone recorded as `<remote>/HEAD`; the remote itself is never asked.
 */
export async function checkGitState(checkout: Checkout, opts: { cwd: string; branch?: string }): Promise<GitState> {
  const tracked = await checkTrackedBranch(checkout, opts);
  if (tracked.kind === "refused") return tracked;
  const { remote, branch } = tracked;
  const commit = checkout.commit.slice(0, 7);
  const position = await firstParentPosition(opts.cwd, `refs/remotes/${remote}/${branch}`, checkout.commit);
  if (position === null) {
    if (checkout.branch === branch) return refused(`this commit isn't on ${remote}/${branch} yet. Push it and try again.`);
    if (checkout.branch !== null) {
      return refused(`you're on ${checkout.branch}, and the dashboard tracks ${branch}. Switch to ${branch} and try again.`);
    }
    return refused(`commit ${commit} isn't on ${branch}. Check out ${branch} and try again.`);
  }
  return { kind: "ok", tracked: { branch, position } };
}

/** The remote and branch the dashboard tracks for this checkout, or why it can't be uploaded: no remote or several, a shallow clone, or no tracked branch. */
export async function checkTrackedBranch(
  checkout: Pick<Checkout, "remote" | "shallow">,
  opts: { cwd: string; branch?: string },
): Promise<{ kind: "ok"; remote: string; branch: string } | { kind: "refused"; message: string }> {
  const { remote } = checkout;
  if (remote.kind === "none") {
    return refused("this checkout has no remote, so Scout can't tell which repository it is. Add one with git remote add origin <url> and try again.");
  }
  if (remote.kind === "several") return refused(severalRemotesLine(remote.names));
  if (checkout.shallow) return refused("this checkout doesn't have the full history. Run git fetch --unshallow and try again.");
  const branch = opts.branch ?? (await recordedDefaultBranch(opts.cwd, remote.name));
  if (branch === null || !(await hasCommit(opts.cwd, `refs/remotes/${remote.name}/${branch}`))) {
    return opts.branch === undefined
      ? refused(`couldn't tell which branch the dashboard tracks. Run git remote set-head ${remote.name} --auto and try again.`)
      : refused(`there's no ${branch} on ${remote.name}. If the branch was renamed, update "branch" in scout.config.json.`);
  }
  return { kind: "ok", remote: remote.name, branch };
}

/**
 * Why an upload can't go ahead with the checkout's local changes, or null when it can: a change to any tracked file, or an
 * untracked file among `files` (the files the scan reads) that isn't in `exempt`. Changes to the files in `ignore` never count,
 * tracked or untracked. `detail` lists the files from the repository's top folder.
 */
export async function uncommittedRefusal(
  cwd: string,
  opts: { files: readonly string[]; exempt: readonly string[]; ignore?: readonly string[] },
): Promise<{ message: string; detail: string } | null> {
  const changes = await localChanges(cwd);
  if (!changes.ok) throw gitFailed(cwd, changes.detail);
  const read = new Set(opts.files.map((file) => resolve(file)));
  const exempt = new Set(opts.exempt.map((file) => resolve(file)));
  const ignored = new Set((opts.ignore ?? []).map((file) => resolve(file)));
  const blocking = [...changes.tracked, ...changes.untracked.filter((file) => read.has(file) && !exempt.has(file))].filter(
    (file) => !ignored.has(file),
  );
  if (blocking.length === 0) return null;
  return {
    message: `${REFUSED} you have uncommitted changes. Commit or stash them and try again.`,
    detail: blocking.map((file) => relative(changes.top, file)).join("\n"),
  };
}
