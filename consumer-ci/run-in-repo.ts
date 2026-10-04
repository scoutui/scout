import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import type { ScanSpec, Step, Target } from "./types.js";

/** Git commands that place the target's working tree into `dir`. Each step is a
 * non-empty argv tuple (command first), so callers need no empty-array guard. */
export function cloneSteps(target: Target, dir: string): [string, ...string[]][] {
  return [["git", "clone", `https://github.com/${target.repo}.git`, dir]];
}

/** The generated Scout config written into a scan's app dir. */
export function scanConfig(scan: ScanSpec): Record<string, unknown> {
  return {
    include: scan.include,
    repoId: scan.repoId,
    gitignore: true,
    // Resolution help for monorepos importing via bundler aliases. configDir is the
    // app dir, so tsconfigPath/aliases are interpreted relative to it.
    ...(scan.tsconfigPath !== undefined ? { tsconfigPath: scan.tsconfigPath } : {}),
    ...(scan.aliases !== undefined ? { aliases: scan.aliases } : {}),
  };
}

/** CLI argv (after the bin path) for one scan, which uploads. */
export function scanArgs(configPath: string, host?: string, rescan = false): string[] {
  // Keep stdout: the nightly log needs the uploaded scanId for verification.
  const args = ["scan", "--config", configPath];
  if (host !== undefined && host !== "") args.push("--host", host);
  if (rescan) args.push("--rescan");
  return args;
}

/** Result of one app-dir scan: failure reasons (empty = passed). */
export interface ScanResult {
  repoId: string;
  failures: string[];
}

/** Where the target's work tree lives, and which step to run. */
export interface RunOptions {
  /** Keep the work tree here instead of in a temporary directory removed afterward. */
  workDir?: string;
  /** Run only this step. Without it, both run. */
  step?: Step;
  /** Scan and upload even when the dashboard already has the commit. */
  rescan?: boolean;
}

/**
 * Clone, install (scriptless, node-modules linker), then scan and upload each
 * app dir. A scan passes when the CLI exits 0, which it does once the upload
 * succeeds. Without `workDir`, the work tree is removed afterward.
 */
export async function runTarget(
  target: Target,
  cliBin: string,
  options: RunOptions = {},
): Promise<ScanResult[]> {
  const { workDir, step, rescan } = options;
  const work = workDir ?? (await mkdtemp(join(tmpdir(), `cc-${target.name}-`)));
  const env = { ...process.env, YARN_NODE_LINKER: "node-modules" };
  try {
    if (step !== "scan") {
      await mkdir(work, { recursive: true });
      for (const [cmd, ...cmdArgs] of cloneSteps(target, work)) {
        await execa(cmd, cmdArgs, { stdio: "inherit" });
      }
      await execa("sh", ["-c", target.install], { cwd: work, env, stdio: "inherit" });
    }
    if (step === "prepare") return [];

    const results: ScanResult[] = [];
    for (let i = 0; i < target.scans.length; i++) {
      const scan = target.scans[i] as ScanSpec;
      const appDir = join(work, scan.cwd);
      const configPath = join(appDir, "scout.config.json");
      await writeFile(configPath, JSON.stringify(scanConfig(scan)));

      const { SCOUTUI_HOST: host } = process.env;
      const { exitCode } = await execa("node", [cliBin, ...scanArgs(configPath, host, rescan)], {
        cwd: appDir,
        env,
        stdio: "inherit",
        reject: false,
      });

      const failures = exitCode === 0 ? [] : [`${scan.repoId}: scan exited ${exitCode}`];
      results.push({ repoId: scan.repoId, failures });
    }
    return results;
  } finally {
    if (workDir === undefined) await rm(work, { recursive: true, force: true });
  }
}
