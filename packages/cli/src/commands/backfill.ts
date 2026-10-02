import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type AuthedUploader, createAuthedUploader } from "../auth/upload-auth.js";
import { defaultSince, firstParentChain, formatDay, weeklyCommits } from "../backfill/commits.js";
import {
  type Corepack,
  type CorepackPlan,
  fetchCorepack,
  findLockfile,
  INSTALL_TIMEOUT_MS,
  type InstallPlan,
  installPlan,
  type NpmPlan,
  packageManagerCommand,
  readPackageManager,
} from "../backfill/install.js";
import { killProcessGroup, type ProcessResult, runProcess } from "../backfill/run-process.js";
import { COMMIT_SCAN_FILE, readCommitScanResult } from "../backfill/scan-commit.js";
import { checkoutCommit, createWorktree, removeWorktreeSync } from "../backfill/worktree.js";
import { INTERNAL_COMMIT_SCAN } from "../cli/parse.js";
import { declaresNuxt } from "../scan/global-components.js";
import { readCheckout, stampMeta } from "../scan/meta.js";
import { type CommitAnswer, preScanRequest } from "../upload-policy/dashboard.js";
import { checkTrackedBranch } from "../upload-policy/git-state.js";
import { describeUploadError, uploadPending } from "../upload.js";
import { readGitToplevel } from "../util/git.js";
import type { Logger } from "../util/log.js";
import { loadScanConfig } from "./scan.js";

export type BackfillOptions = {
  configPath: string;
  /** The earliest committer date to pick, as `YYYY-MM-DD`. Defaults to six calendar months ago. */
  since?: string;
  rescan: boolean;
  hostOverride?: string;
  log: Logger;
  /** The CLI's entry script, which the run starts once per commit to scan it. */
  cliEntry: string;
};

/** What a signal has to stop: the run folder once it exists, and the one process running now. */
type RunState = { run: { cwd: string; dir: string } | undefined; pid: number | undefined };

/** How installing one commit ended. */
type Install =
  | { kind: "installed" }
  | { kind: "no-lockfile" }
  | { kind: "install-failed"; label: InstallPlan["label"] | null; result: ProcessResult }
  | { kind: "nuxt-failed"; result: ProcessResult }
  | { kind: "corepack-failed"; output: string };

/** The run's folders, the config's install command, and the Corepack fetched for the run so far. */
type RunContext = {
  runDir: string;
  checkout: string;
  configDir: string;
  install: string | undefined;
  corepack: Corepack | undefined;
};

const PRE_SCAN_CHUNK = 500;

const COREPACK_FAILED =
  "Couldn't download Corepack, which Scout needs to install Yarn and pnpm projects. Check your connection and npm registry settings, then run scout backfill again.";

/**
 * Scans one commit a week of the tracked branch's history, newest first, each in a temporary worktree with its
 * dependencies installed, and uploads the scans the dashboard doesn't have yet. Returns the exit code.
 */
export async function runBackfill(opts: BackfillOptions): Promise<number> {
  const state: RunState = { run: undefined, pid: undefined };
  const onSignal = (): void => {
    if (state.pid !== undefined) killProcessGroup(state.pid);
    if (state.run !== undefined) removeWorktreeSync(state.run.cwd, state.run.dir);
    process.exit(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    return await backfill(opts, state);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (state.run !== undefined) removeWorktreeSync(state.run.cwd, state.run.dir);
  }
}

async function backfill(opts: BackfillOptions, state: RunState): Promise<number> {
  const { log, rescan } = opts;
  const progress = (line: string): void => {
    if (!log.quiet) process.stderr.write(`${line}\n`);
  };

  const cfg = await loadScanConfig(opts.configPath, log);
  if (cfg === null) return 2;
  const checkout = await readCheckout(cfg.configDir, log);
  const tracked = await checkTrackedBranch(checkout, {
    cwd: cfg.configDir,
    ...(cfg.branch !== undefined ? { branch: cfg.branch } : {}),
  });
  if (tracked.kind === "refused") {
    log.error(tracked.message);
    return 1;
  }
  const top = (await readGitToplevel(cfg.configDir)) ?? cfg.configDir;
  const configText = await readFile(cfg.configPath, "utf8");

  const since = opts.since ?? defaultSince(new Date());
  const ref = `${tracked.remote}/${tracked.branch}`;
  const picked = weeklyCommits(await firstParentChain(cfg.configDir, `refs/remotes/${ref}`), since);
  const meta = stampMeta(checkout, {
    cwd: cfg.configDir,
    ...(cfg.repoId !== undefined ? { repoIdOverride: cfg.repoId } : {}),
  });

  let waiting = false;
  let uploader: AuthedUploader | undefined;
  const answers = new Map<string, CommitAnswer>();
  try {
    uploader = await createAuthedUploader({
      ...(opts.hostOverride !== undefined ? { flagHost: opts.hostOverride } : {}),
      ...(cfg.host !== undefined ? { configHost: cfg.host } : {}),
      onStatus: (status) => {
        if (uploadPending(status) && !waiting) {
          waiting = true;
          log.detail("Waiting for the dashboard to process the scan…");
        }
      },
    });
    for (let start = 0; start < picked.length; start += PRE_SCAN_CHUNK) {
      const chunk = picked.slice(start, start + PRE_SCAN_CHUNK).map(({ commit }) => commit);
      for (const answer of (await uploader.check(preScanRequest(meta, false, chunk), log)) ?? []) {
        answers.set(answer.commit, answer);
      }
    }
  } catch (err) {
    const { message, detail } = describeUploadError(err, uploader?.base);
    log.error(message, detail);
    return 1;
  }

  const already = picked.filter(({ commit }) => answers.get(commit)?.decision === "skip").length;
  const refused = picked.filter(({ commit }) => answers.get(commit)?.decision === "refuse").length;
  const toScan = picked.filter(({ commit }) => {
    const decision = answers.get(commit)?.decision;
    return decision !== "refuse" && (rescan || decision !== "skip");
  });
  const counts = { uploaded: 0, already: rescan ? 0 : already, skipped: refused, replaced: 0 };
  const link = new URL(`/repos/${encodeURIComponent(meta.repo.id)}`, uploader.base).href;
  const endLine = (): string =>
    `Backfilled ${tracked.branch} since ${formatDay(since)}: ${counts.uploaded} uploaded, ${counts.already} already there, ${counts.skipped} skipped${rescan ? `, ${counts.replaced} replaced` : ""}. See ${link}`;

  const [first] = toScan;
  if (first === undefined) {
    log.result(endLine());
    return 0;
  }
  progress(startLine({ found: picked.length, already, scan: toScan.length, rescan, ref, since: formatDay(since) }));

  const runDir = await realpath(await mkdtemp(join(tmpdir(), "scout-backfill-")));
  state.run = { cwd: cfg.configDir, dir: runDir };
  const checkoutDir = await createWorktree(cfg.configDir, runDir, first.commit);
  const work: RunContext = {
    runDir,
    checkout: checkoutDir,
    configDir: join(checkoutDir, relative(top, cfg.configDir)),
    install: cfg.install,
    corepack: undefined,
  };
  const configPath = join(checkoutDir, relative(top, cfg.configPath));

  for (const [index, { commit, committedAt }] of toScan.entries()) {
    progress(`Scanning ${commit.slice(0, 7)} (${formatDay(committedAt)}), ${index + 1} of ${toScan.length}…`);
    await checkoutCommit(checkoutDir, commit);
    await writeFile(configPath, configText);

    const installed = await install(work, state, log);
    if (installed.kind === "corepack-failed") {
      log.error(COREPACK_FAILED, installed.output);
      return 1;
    }
    if (installed.kind !== "installed") {
      counts.skipped++;
      continue;
    }

    const outDir = join(runDir, commit);
    await mkdir(outDir);
    const child = await finished(
      state,
      runProcess(process.execPath, [opts.cliEntry, INTERNAL_COMMIT_SCAN, configPath, outDir, ...(log.debug ? ["--debug"] : [])], {
        cwd: work.configDir,
      }),
    );
    log.detail(child.output);
    const result = await readCommitScanResult(outDir);
    if (result?.kind === "scanned") {
      waiting = false;
      const uploaded = await uploader.upload(await readFile(join(outDir, COMMIT_SCAN_FILE), "utf8"), { rescan });
      if (uploaded.status === "exists") counts.already++;
      else if (rescan && uploaded.replaced) counts.replaced++;
      else counts.uploaded++;
    } else {
      counts.skipped++;
    }
    await rm(outDir, { recursive: true, force: true });
  }

  log.result(endLine());
  return 0;
}

/** Installs the commit checked out in `work`: with the config's `install` command, else from its lockfile, then `nuxt prepare` for a Nuxt app. */
async function install(work: RunContext, state: RunState, log: Logger): Promise<Install> {
  const run = async (command: { command: string; args: string[] }, cwd: string, shell = false): Promise<ProcessResult> => {
    const result = await finished(state, runProcess(command.command, command.args, { cwd, shell, timeoutMs: INSTALL_TIMEOUT_MS }));
    log.detail(result.output);
    return result;
  };

  if (work.install !== undefined) {
    const result = await run({ command: work.install, args: [] }, work.checkout, true);
    return result.code === 0 ? { kind: "installed" } : { kind: "install-failed", label: null, result };
  }

  const lockfile = findLockfile(work.configDir, work.checkout);
  if (lockfile === null) return { kind: "no-lockfile" };
  const head = (await readFile(join(lockfile.dir, lockfile.name), "utf8")).slice(0, 2048);
  const plan = installPlan(lockfile.name, head, readPackageManager(lockfile));
  let runnable: NpmPlan | (CorepackPlan & { corepack: Corepack });
  if (plan.manager === "npm") {
    runnable = plan;
  } else {
    if (work.corepack === undefined) {
      const fetched = await finished(state, fetchCorepack(work.runDir));
      if (fetched.kind === "failed") return { kind: "corepack-failed", output: fetched.output };
      work.corepack = fetched.corepack;
    }
    runnable = { ...plan, corepack: work.corepack };
  }

  const result = await run(packageManagerCommand(runnable, "install"), lockfile.dir);
  if (result.code !== 0) return { kind: "install-failed", label: plan.label, result };
  if (declaresNuxt(work.configDir)) {
    const prepared = await run(packageManagerCommand(runnable, "nuxtPrepare"), work.configDir);
    if (prepared.code !== 0) return { kind: "nuxt-failed", result: prepared };
  }
  return { kind: "installed" };
}

/** What `running` ends with, with its process id held in `state` until then. */
async function finished<T>(state: RunState, running: { pid: number | undefined; done: Promise<T> }): Promise<T> {
  state.pid = running.pid;
  try {
    return await running.done;
  } finally {
    state.pid = undefined;
  }
}

/** The line that says how many commits were found and how many will be scanned. */
function startLine(o: { found: number; already: number; scan: number; rescan: boolean; ref: string; since: string }): string {
  if (o.found === 1) {
    return `Found 1 commit on ${o.ref} since ${o.since}. Scout will scan it${o.already === 1 ? ", replacing the one already on the dashboard" : ""}.`;
  }
  const found = `Found ${o.found} commits on ${o.ref}, one a week since ${o.since}.`;
  const scan = o.scan === o.found ? `all ${o.scan}` : String(o.scan);
  if (o.already === 0) return `${found} Scout will scan ${scan}.`;
  if (o.rescan) return `${found} Scout will scan ${scan}, replacing the ${o.already} already on the dashboard.`;
  return `${found} ${o.already === 1 ? "1 is" : `${o.already} are`} already on the dashboard, so Scout will scan ${o.scan}.`;
}
