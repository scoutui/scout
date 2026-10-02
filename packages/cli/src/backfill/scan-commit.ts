import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { loadScanConfig, readWorkspace, scanOutputRoot, scanRepository } from "../commands/scan.js";
import { readCheckout, stampMeta } from "../scan/meta.js";
import { checkGitState, uncommittedRefusal } from "../upload-policy/git-state.js";
import { emptyScanRefusal, setupProblem } from "../upload-policy/index.js";
import { Logger } from "../util/log.js";
import { isPnpProject } from "../util/pnp-check.js";

/** What scanning one commit came to, as the child writes it to `result.json`. With `scanned`, the scan file is `scan.json` beside it. */
export type CommitScanResult =
  | { kind: "scanned" }
  | { kind: "empty" }
  | { kind: "refused"; reason: "uncommitted" | "pnp" | "dependencies-missing" | "nuxt-unprepared"; detail?: string };

/**
 * Scans the checkout of the config at `args[0]` with the checks an upload makes, and writes `result.json`, and `scan.json`
 * for a commit it scanned, into the folder at `args[1]`. Returns 0 once `result.json` is written. When the config can't be
 * loaded (2) or the commit can't be uploaded from this checkout (1), it prints why and writes nothing.
 */
export async function runCommitScan(args: string[], log: Logger): Promise<number> {
  const [configPath, outDir] = args;
  if (configPath === undefined || outDir === undefined) return 2;
  const scanLog = new Logger({ quiet: !log.debug, debug: log.debug });
  const finish = async (result: CommitScanResult): Promise<number> => {
    await writeFile(join(outDir, "result.json"), JSON.stringify(result));
    return 0;
  };

  const startedAt = performance.now();
  const cfg = await loadScanConfig(configPath, scanLog);
  if (cfg === null) return 2;
  const checkout = await readCheckout(cfg.configDir, scanLog);
  const state = await checkGitState(checkout, {
    cwd: cfg.configDir,
    ...(cfg.branch !== undefined ? { branch: cfg.branch } : {}),
  });
  if (state.kind === "refused") {
    scanLog.error(state.message);
    return 1;
  }
  const meta = stampMeta(checkout, {
    cwd: cfg.configDir,
    ...(cfg.repoId !== undefined ? { repoIdOverride: cfg.repoId } : {}),
    tracked: state.tracked,
  });
  const outputRoot = await scanOutputRoot(cfg.configDir, {});
  const { workspaceRoot, workspaceGraph, files } = await readWorkspace(cfg, outputRoot, scanLog);

  const uncommitted = await uncommittedRefusal(cfg.configDir, { files, exempt: [], ignore: cfg.configPath });
  if (uncommitted !== null) return finish({ kind: "refused", reason: "uncommitted", detail: uncommitted.detail });
  if (isPnpProject(cfg.configDir) || isPnpProject(workspaceRoot)) return finish({ kind: "refused", reason: "pnp" });
  const problem = setupProblem(workspaceGraph, files, cfg.configDir);
  if (problem !== null) return finish({ kind: "refused", reason: problem });

  const { artifact, stats } = await scanRepository({
    cfg,
    outputRoot,
    workspaceRoot,
    workspaceGraph,
    files,
    meta,
    log: scanLog,
    startedAt,
  });
  if (emptyScanRefusal(stats, { configPath: cfg.configPath }) !== null) return finish({ kind: "empty" });
  await writeFile(join(outDir, "scan.json"), JSON.stringify(artifact));
  return finish({ kind: "scanned" });
}

/** What the child wrote to `result.json` in `outDir`, or null when it wrote none. */
export async function readCommitScanResult(outDir: string): Promise<CommitScanResult | null> {
  try {
    return JSON.parse(await readFile(join(outDir, "result.json"), "utf8")) as CommitScanResult;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
