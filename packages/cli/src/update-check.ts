import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { compareCliVersions, isSnapshotVersion } from "@scoutui/scan-format";
import { type AnyLockfile, findAnyLockfile, foldersUp, isYarnClassic, lockfileManager } from "./backfill/install.js";
import { terminalStyle } from "./util/style.js";

const PACKAGE = "@scoutui/cli";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 1000;

const UPGRADE_GUIDE = "https://scoutui.dev/docs/guides/upgrade-scout#version-messages";

const INSTALL = { npm: "npm i -D", yarn: "yarn add -D", pnpm: "pnpm add -D", bun: "bun add -d" } as const;

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

/** What earlier runs found out: when the registry was last asked, its latest release, and the scan formats the dashboard last said it reads. */
export type Kept = { checkedAt: number | null; latest: Release | null; scanFormats: number[] | null };

/**
 * Starts the check for a newer release. `latest` and `scanFormats` are what earlier runs kept at `cachePath`, so the
 * notice can show at once. When the registry was last asked a day or more ago, or never, it's asked again in the
 * background and its answer kept for the next run; `done` settles once it is, within `timeoutMs`. A failed ask keeps
 * the last release.
 */
export function startUpdateCheck(opts: {
  cachePath: string;
  now?: number;
  fetch?: Fetch;
  timeoutMs?: number;
}): Kept & { done: Promise<void> } {
  const now = opts.now ?? Date.now();
  const kept = readKept(opts.cachePath);
  const fresh = kept.checkedAt !== null && kept.checkedAt <= now && now - kept.checkedAt < DAY_MS;
  const done = fresh
    ? Promise.resolve()
    : askRegistry(opts.fetch ?? fetch, opts.timeoutMs ?? TIMEOUT_MS).then((latest) =>
        keep(opts.cachePath, latest === null ? { checkedAt: now } : { checkedAt: now, latest }),
      );
  return { ...kept, done };
}

/** Keeps the scan formats the dashboard says it reads, for the next run's notice. */
export function keepScanFormats(cachePath: string, scanFormats: number[]): void {
  keep(cachePath, { scanFormats });
}

/**
 * The line telling someone that `latest` is out, or null when it isn't newer than the `running` version or that's a
 * snapshot build. When the dashboard said which `scanFormats` it reads and they leave out the release's, a second line
 * says to wait for the dashboard's upgrade. Otherwise it names the command that updates the CLI in `cwd`, or installs it
 * when the repo doesn't, looking for the lockfile no higher than `root` (default: the top of the file system).
 */
export function updateNotice(opts: {
  running: string;
  latest: Release | null;
  scanFormats: readonly number[] | null;
  cwd: string;
  root?: string;
}): string | null {
  const { latest } = opts;
  if (latest === null || isSnapshotVersion(opts.running) || compareCliVersions(latest.version, opts.running) <= 0) return null;
  const available = `Scout ${latest.version} is available`;
  if (latest.scanFormat !== null && opts.scanFormats !== null && !opts.scanFormats.includes(latest.scanFormat)) {
    return `${available}, but your dashboard can't read its scans yet.\nKeep this version until your dashboard is upgraded. See ${UPGRADE_GUIDE}`;
  }
  const update = updateCommand(opts.cwd, opts.root ?? parse(resolve(opts.cwd)).root);
  return `${available}. ${update.installed ? "Update" : "Install it"} with ${update.command}.`;
}

/**
 * The command that adds the latest CLI as a dev dependency with the repo's package manager (npm when there's no
 * lockfile), and whether it's `installed` already: listed in a package.json from `cwd` up to the lockfile's folder. The
 * command adds it to that package.json, or else to the nearest one. When that's a workspace's root, pnpm gets `-w` and
 * Yarn 1 `-W`, which they need to add there.
 */
function updateCommand(cwd: string, root: string): { installed: boolean; command: string } {
  const lockfile = findAnyLockfile(cwd, root);
  const manager = lockfile === null ? "npm" : lockfileManager(lockfile);
  const folders = foldersUp(cwd, lockfile?.dir ?? root);
  const listed = folders.find((dir) => listsCli(readManifest(dir)));
  const target = listed ?? folders.find((dir) => readManifest(dir) !== null) ?? cwd;
  const yarnClassic = lockfile !== null && manager === "yarn" && isYarnClassic(readHead(lockfile));
  const rootFlag =
    manager === "pnpm" && existsSync(join(target, "pnpm-workspace.yaml"))
      ? " -w"
      : yarnClassic && readManifest(target)?.workspaces !== undefined
        ? " -W"
        : "";
  return { installed: listed !== undefined, command: `${INSTALL[manager]}${rootFlag} ${PACKAGE}@latest` };
}

type Manifest = { dependencies?: unknown; devDependencies?: unknown; workspaces?: unknown };

function readManifest(dir: string): Manifest | null {
  return readJson(join(dir, "package.json")) as Manifest | null;
}

function listsCli(manifest: Manifest | null): boolean {
  return [manifest?.dependencies, manifest?.devDependencies].some(
    (deps) => typeof deps === "object" && deps !== null && PACKAGE in deps,
  );
}

function readHead(lockfile: AnyLockfile): string {
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

/** What's kept at `path`, each part null when it's missing or can't be read. */
function readKept(path: string): Kept {
  const kept = readJson(path) as { checkedAt?: unknown; latest?: { version?: unknown; scanFormat?: unknown } | null; scanFormats?: unknown } | null;
  const { version, scanFormat } = kept?.latest ?? {};
  const latest = typeof version === "string" && (scanFormat === null || Number.isInteger(scanFormat)) ? { version, scanFormat: scanFormat as number | null } : null;
  const scanFormats = kept?.scanFormats;
  return {
    checkedAt: typeof kept?.checkedAt === "number" ? kept.checkedAt : null,
    latest,
    scanFormats: Array.isArray(scanFormats) && scanFormats.every((format) => Number.isInteger(format)) ? scanFormats : null,
  };
}

/** Writes `parts` over what's kept at `path`. */
function keep(path: string, parts: Partial<Kept>): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...readKept(path), ...parts }));
  } catch {
    // Without a cache folder, nothing is kept and the registry is asked on every run.
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
