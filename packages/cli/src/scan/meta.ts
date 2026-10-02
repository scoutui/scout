import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ulid } from "ulid";
import { probeRepository, readGitCommitDate, readGitBranch, selectRemote, type RemoteChoice } from "../util/git.js";
import { readToolPackage } from "../envelope/index.js";
import { CliError } from "../cli/parse.js";
import type { Logger } from "../util/log.js";
import type { TrackedBranch } from "../upload-policy/git-state.js";
import type { ScanMeta } from "@scoutui/scan-format";

/** The scan file's metadata, before `emitArtifact` adds its `schemaVersion`. */
export type StampedMeta = Omit<ScanMeta, "schemaVersion">;

/** What git says about the checkout a scan reads. Read once per scan; the upload checks and the metadata use the same one. */
export type Checkout = {
  commit: string;
  /** The committer date of `commit`, as an ISO 8601 UTC timestamp. */
  committedAt: string;
  initialCommit: string | null;
  shallow: boolean;
  remote: RemoteChoice;
  /** The checked-out branch, or null on a detached HEAD. */
  branch: string | null;
};

/** The line for git failing in `cwd`, with git's own message as its detail. */
export function gitFailed(cwd: string, detail: string): CliError {
  return new CliError(`Couldn't scan: git failed in ${cwd}. Run git status there to see why, then try again.`, 1, { detail });
}

/** Reads the checkout at `cwd`, or throws the line that says why it can't be scanned. */
export async function readCheckout(cwd: string, log?: Logger): Promise<Checkout> {
  const repository = await probeRepository(cwd);
  if (repository.kind === "outside") {
    throw new CliError(`Couldn't scan: ${cwd} isn't inside a git repository. Run scout scan from a git checkout.`, 1);
  }
  if (repository.kind === "no-commits") {
    throw new CliError("Couldn't scan: this repository has no commits yet. Commit your files and try again.", 1);
  }
  if (repository.kind === "failed") throw gitFailed(cwd, repository.detail);
  const rawCommitDate = await readGitCommitDate(cwd);
  const commitTime = Date.parse(rawCommitDate ?? "");
  if (Number.isNaN(commitTime)) {
    throw new CliError(
      `Couldn't read the date of the current commit in ${cwd}. Check that git log -1 works there, then try again.`,
      1,
      { detail: `The commit date git printed: ${JSON.stringify(rawCommitDate ?? "")}` },
    );
  }
  return {
    commit: repository.commit,
    committedAt: new Date(commitTime).toISOString(),
    initialCommit: repository.initialCommit,
    shallow: repository.shallow,
    remote: await selectRemote(cwd, log),
    branch: await readGitBranch(cwd),
  };
}

/**
 * The scan file's metadata for `checkout`. With `tracked`, which only an upload passes, it records the branch the dashboard
 * tracks and the commit's position on it; otherwise the checked-out branch.
 */
export function stampMeta(
  checkout: Checkout,
  opts: { cwd: string; repoIdOverride?: string; tracked?: TrackedBranch },
): StampedMeta {
  const gitRemote = checkout.remote.kind === "ok" ? checkout.remote.url : null;
  const tool = readCliPackage();
  return {
    ...(tool.name !== undefined ? { scannerName: tool.name } : {}),
    scannerVersion: tool.version,
    scanId: ulid(),
    scannedAt: new Date().toISOString(),
    repo: {
      id: opts.repoIdOverride ?? deriveId(gitRemote, opts.cwd),
      gitRemote,
      commit: checkout.commit,
      committedAt: checkout.committedAt,
      ...(opts.tracked !== undefined ? { branchPosition: opts.tracked.position } : {}),
      initialCommit: checkout.initialCommit,
      branch: opts.tracked?.branch ?? checkout.branch,
    },
  };
}

function deriveId(remote: string | null, cwd: string): string {
  if (remote) {
    const match = remote.match(/[/:]([^/]+?)(\.git)?$/);
    if (match?.[1]) return match[1];
  }
  return basename(cwd);
}

/** The CLI's own package.json: its name, version and where to report a bug. */
export function readCliPackage(): ReturnType<typeof readToolPackage> {
  return readToolPackage(findCliPackageRoot());
}

/**
 * Walk up from this module's directory to the @scoutui/cli package.json, so
 * it works from dist/ or src/ (vitest).
 */
function findCliPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "package.json");
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { name?: unknown };
      if (parsed.name === "@scoutui/cli") return dir;
    } catch {
      // continue walking
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(fileURLToPath(import.meta.url));
}
