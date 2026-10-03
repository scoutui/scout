import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { compareCliVersions, isSnapshotVersion } from "@scoutui/scan-format";
import { findLockfile, foldersUp, isYarnClassic, type Lockfile, lockfileManager } from "./backfill/install.js";
import { readGitToplevel } from "./util/git.js";
import { type Colorizer, terminalStyle } from "./util/style.js";

const PACKAGE = "@scoutui/cli";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 1000;

const INSTALL = { npm: "npm i -D", yarn: "yarn add -D", pnpm: "pnpm add -D", bun: "bun add -d" } as const;
const RUN = { npm: "npx", yarn: "yarn dlx", pnpm: "pnpm dlx", bun: "bunx" } as const;

/** The CLI's latest release, and the scan format it writes when its package.json says. */
export type Release = { version: string; scanFormat: number | null };

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

type Stream = { isTTY?: boolean };

/**
 * Whether to look for a newer release: someone is watching in a terminal, the command isn't run with `--quiet`,
 * SCOUTUI_NO_UPDATE_CHECK is unset, empty or `0`, and NO_UPDATE_NOTIFIER isn't set.
 */
export function updateCheckWanted(opts: {
  argv: readonly string[];
  env?: NodeJS.ProcessEnv;
  stdin?: Stream;
  stdout?: Stream;
  stderr?: Stream;
}): boolean {
  const env = opts.env ?? process.env;
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const off = env["SCOUTUI_NO_UPDATE_CHECK"];
  if (off !== undefined && off !== "" && off !== "0") return false;
  // biome-ignore lint/complexity/useLiteralKeys: env access
  if (env["NO_UPDATE_NOTIFIER"] !== undefined || opts.argv.includes("--quiet")) return false;
  return terminalStyle({
    env,
    stdin: opts.stdin ?? process.stdin,
    stdout: opts.stdout ?? process.stdout,
    stderr: opts.stderr ?? process.stderr,
  }).interactive;
}

/** Where the latest release is kept between runs: `scoutui/update-check.json` in XDG_CACHE_HOME, else in `~/.cache`. */
export function updateCachePath(env: NodeJS.ProcessEnv = process.env): string {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const xdg = env["XDG_CACHE_HOME"];
  return join(xdg && xdg.trim() !== "" ? xdg : join(homedir(), ".cache"), "scoutui", "update-check.json");
}

/**
 * The CLI's latest release on the npm registry. The answer is kept at `cachePath`, and the registry is asked again only
 * once the answer is a day old, a failed ask included. Null when the registry doesn't answer within `timeoutMs` or its
 * answer can't be read.
 */
export async function latestRelease(opts: {
  cachePath: string;
  now?: number;
  fetch?: Fetch;
  timeoutMs?: number;
}): Promise<Release | null> {
  const now = opts.now ?? Date.now();
  const kept = readKept(opts.cachePath);
  if (kept !== null && kept.checkedAt <= now && now - kept.checkedAt < DAY_MS) return kept.latest;
  const latest = await askRegistry(opts.fetch ?? fetch, opts.timeoutMs ?? TIMEOUT_MS);
  try {
    mkdirSync(dirname(opts.cachePath), { recursive: true });
    writeFileSync(opts.cachePath, JSON.stringify({ checkedAt: now, latest }));
  } catch {
    // Without a cache folder, the registry is asked on every run.
  }
  return latest;
}

/**
 * The line telling someone that `latest` is out, or null when it isn't newer than the `running` version or that's a
 * snapshot build. When the dashboard said which `scanFormats` it reads and they leave out the release's, the line says
 * to wait for the dashboard. Otherwise it names the command that gets the release in `cwd`, in the repo whose top
 * folder is `root` (default: git's top folder for `cwd`).
 */
export async function updateNotice(opts: {
  running: string;
  latest: Release | null;
  scanFormats: readonly number[] | null;
  cwd: string;
  root?: string;
  color: Colorizer;
}): Promise<string | null> {
  const { latest, color } = opts;
  if (latest === null || isSnapshotVersion(opts.running) || compareCliVersions(latest.version, opts.running) <= 0) return null;
  const available = `Scout ${color.bold(latest.version)} is available`;
  if (latest.scanFormat !== null && opts.scanFormats !== null && !opts.scanFormats.includes(latest.scanFormat)) {
    return `${available}, but your dashboard can't read its scans yet. Stay on this version until your dashboard administrator upgrades it.`;
  }
  const root = opts.root ?? (await readGitToplevel(opts.cwd)) ?? opts.cwd;
  const update = updateCommand(opts.cwd, root);
  return update.install ? `${available}. Update with ${update.command}.` : `${available}. Run it with ${update.command}.`;
}

/**
 * How to get the latest CLI in `cwd`: install it with the repo's package manager when a package.json from `cwd` up to
 * the lockfile's folder lists it, or else run it with that package manager's runner. npm when there's no lockfile.
 */
function updateCommand(cwd: string, root: string): { install: boolean; command: string } {
  const lockfile = findLockfile(cwd, root);
  const manager = lockfile === null ? "npm" : lockfileManager(lockfile);
  if (foldersUp(cwd, lockfile?.dir ?? root).some(listsCli)) return { install: true, command: `${INSTALL[manager]} ${PACKAGE}@latest` };
  const runner = lockfile !== null && manager === "yarn" && isYarnClassic(readHead(lockfile)) ? RUN.npm : RUN[manager];
  return { install: false, command: `${runner} ${PACKAGE}@latest` };
}

function listsCli(dir: string): boolean {
  const manifest = readJson(join(dir, "package.json")) as { dependencies?: unknown; devDependencies?: unknown } | null;
  return [manifest?.dependencies, manifest?.devDependencies].some(
    (deps) => typeof deps === "object" && deps !== null && PACKAGE in deps,
  );
}

function readHead(lockfile: Lockfile): string {
  try {
    return readFileSync(join(lockfile.dir, lockfile.name), "utf8").slice(0, 2048);
  } catch {
    return "";
  }
}

async function askRegistry(fetcher: Fetch, timeoutMs: number): Promise<Release | null> {
  try {
    const res = await fetcher(REGISTRY_URL, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
    return readRelease(await res.json());
  } catch {
    return null;
  }
}

/** The release a registry answer describes: its version, and `scout.scanFormat` from its package.json. */
function readRelease(body: unknown): Release | null {
  if (typeof body !== "object" || body === null) return null;
  const { version, scout } = body as { version?: unknown; scout?: { scanFormat?: unknown } | null };
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) return null;
  const scanFormat = scout?.scanFormat;
  return { version, scanFormat: Number.isInteger(scanFormat) ? (scanFormat as number) : null };
}

/** The answer kept at `path`, or null when there's none or it can't be read. */
function readKept(path: string): { checkedAt: number; latest: Release | null } | null {
  const kept = readJson(path) as { checkedAt?: unknown; latest?: { version?: unknown; scanFormat?: unknown } | null } | null;
  if (typeof kept?.checkedAt !== "number") return null;
  if (kept.latest === null) return { checkedAt: kept.checkedAt, latest: null };
  const { version, scanFormat } = kept.latest ?? {};
  if (typeof version !== "string" || !(scanFormat === null || Number.isInteger(scanFormat))) return null;
  return { checkedAt: kept.checkedAt, latest: { version, scanFormat: scanFormat as number | null } };
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
