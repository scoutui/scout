import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runProcess } from "./run-process.js";

export type Lockfile = { dir: string; name: "pnpm-lock.yaml" | "yarn.lock" | "package-lock.json" };

/** How to install from a lockfile. `packageManagerCommand` turns `install` or `nuxtPrepare` into the command to run. */
export type InstallPlan = NpmPlan | CorepackPlan;

export type NpmPlan = { manager: "npm"; install: string[]; nuxtPrepare: string[]; label: "npm ci" };

/** A Yarn or pnpm plan. `spec` is the `<name>@<version>` Corepack runs. */
export type CorepackPlan = {
  manager: "yarn" | "pnpm";
  spec: string;
  install: string[];
  nuxtPrepare: string[];
  label: "yarn install" | "pnpm install";
};

/** The Corepack `fetchCorepack` installed. `script` is its `corepack.js`. */
export type Corepack = { script: string };

export type CorepackFetch = { kind: "fetched"; corepack: Corepack } | { kind: "failed"; output: string };

/** How long an install may run before it is stopped. */
export const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

type DevEngine = { name?: unknown; version?: unknown } | null | undefined;

type Manifest = { packageManager?: unknown; devEngines?: { packageManager?: DevEngine | DevEngine[] } | null };

const LOCKFILES = ["pnpm-lock.yaml", "yarn.lock", "package-lock.json"] as const;

const MANAGER_OF = {
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
} as const;

type WriterRows = readonly [readonly [string, string], ...(readonly [string, string])[]];

/**
 * Yarn 1's release, and each Yarn 2+ `__metadata.version` and pnpm `lockfileVersion`, newest first, with the newest
 * release that writes it.
 */
const LOCKFILE_WRITERS: { yarnClassic: string; yarn: WriterRows; pnpm: WriterRows } = {
  yarnClassic: "1.22.22",
  yarn: [
    ["10", "4.18.1"],
    ["9", "4.14.1"],
    ["8", "4.13.0"],
    ["6", "3.8.7"],
    ["5", "3.1.1"],
    ["4", "3.0.2"],
  ],
  pnpm: [
    ["9.0", "12.8.1"],
    ["6.0", "8.15.9"],
    ["5.4", "7.33.7"],
  ],
};

/**
 * The nearest folder from `configDir` up to `root` holding a `pnpm-lock.yaml`, `yarn.lock` or `package-lock.json`.
 * When it holds several, the one whose manager the folder's `packageManager` names, else the first in that order.
 */
export function findLockfile(configDir: string, root: string): Lockfile | null {
  const top = resolve(root);
  for (let dir = resolve(configDir); ; dir = dirname(dir)) {
    const found = LOCKFILES.filter((name) => existsSync(join(dir, name)));
    const packageManager = found.length > 1 ? packageManagerField(readManifest(dir)) : undefined;
    const name = found.find((lockfile) => names(packageManager, MANAGER_OF[lockfile])) ?? found[0];
    if (name !== undefined) return { dir, name };
    if (dir === top || dirname(dir) === dir) return null;
  }
}

/**
 * The package manager the `package.json` beside `lockfile` declares: its `packageManager`, else the
 * `devEngines.packageManager` entry that names the lockfile's manager and has a version, as `<name>@<version>`.
 */
export function readPackageManager(lockfile: Lockfile): string | undefined {
  const manifest = readManifest(lockfile.dir);
  return packageManagerField(manifest) ?? devEnginesPackageManager(manifest, MANAGER_OF[lockfile.name]);
}

/**
 * The install for `lockfile`, given the start of its text (`head`) and the package manager its folder declares. Yarn
 * and pnpm use that package manager as written when it names them, else the release that writes the lockfile's
 * version, else the newest release listed for them.
 */
export function installPlan(lockfile: Lockfile["name"], head: string, packageManager: string | undefined): InstallPlan {
  if (lockfile === "package-lock.json") {
    return {
      manager: "npm",
      install: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      nuxtPrepare: ["exec", "--", "nuxt", "prepare"],
      label: "npm ci",
    };
  }
  if (lockfile === "pnpm-lock.yaml") {
    const version = /^lockfileVersion: ['"]?([\d.]+)/m.exec(head)?.[1];
    return {
      manager: "pnpm",
      spec: spec("pnpm", packageManager, writer(LOCKFILE_WRITERS.pnpm, version)),
      install: ["install", "--frozen-lockfile", "--ignore-scripts"],
      nuxtPrepare: ["exec", "nuxt", "prepare"],
      label: "pnpm install",
    };
  }
  if (/^# yarn lockfile v1\b/m.test(head)) {
    return {
      manager: "yarn",
      spec: spec("yarn", packageManager, LOCKFILE_WRITERS.yarnClassic),
      install: ["install", "--frozen-lockfile", "--ignore-scripts", "--ignore-engines", "--non-interactive"],
      nuxtPrepare: ["nuxt", "prepare"],
      label: "yarn install",
    };
  }
  const version = /^__metadata:\r?\n[ \t]+version: (\d+)/m.exec(head)?.[1];
  return {
    manager: "yarn",
    spec: spec("yarn", packageManager, writer(LOCKFILE_WRITERS.yarn, version)),
    install: ["install", "--immutable", "--mode=skip-build"],
    nuxtPrepare: ["nuxt", "prepare"],
    label: "yarn install",
  };
}

/**
 * Installs Corepack into `<runDir>/tools` with the user's own npm. `done` gives that Corepack, or npm's output when
 * the install failed, ran out of time or left no `corepack.js` behind.
 */
export function fetchCorepack(runDir: string): { pid: number | undefined; done: Promise<CorepackFetch> } {
  const tools = join(runDir, "tools");
  mkdirSync(tools);
  const npm = runProcess(
    "npm",
    [
      "install",
      "--prefix",
      tools,
      "corepack@0.36.0",
      "--no-save",
      "--no-package-lock",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-bin-links",
    ],
    { cwd: tools, timeoutMs: INSTALL_TIMEOUT_MS },
  );
  const script = join(tools, "node_modules", "corepack", "dist", "corepack.js");
  return {
    pid: npm.pid,
    done: npm.done.then(
      ({ code, output }): CorepackFetch =>
        code === 0 && existsSync(script) ? { kind: "fetched", corepack: { script } } : { kind: "failed", output },
    ),
  };
}

/**
 * The command that runs `plan`'s `install` or `nuxtPrepare`: the user's own `npm`, or Yarn and pnpm through
 * `plan.corepack` with the Node running Scout.
 */
export function packageManagerCommand(
  plan: NpmPlan | (CorepackPlan & { corepack: Corepack }),
  step: "install" | "nuxtPrepare",
): { command: string; args: string[] } {
  if (plan.manager === "npm") return { command: "npm", args: [...plan[step]] };
  return { command: process.execPath, args: [plan.corepack.script, plan.spec, ...plan[step]] };
}

function readManifest(dir: string): Manifest | undefined {
  try {
    return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest | null) ?? undefined;
  } catch {
    return undefined;
  }
}

function packageManagerField(manifest: Manifest | undefined): string | undefined {
  return typeof manifest?.packageManager === "string" ? manifest.packageManager : undefined;
}

function devEnginesPackageManager(manifest: Manifest | undefined, manager: string): string | undefined {
  const declared = manifest?.devEngines?.packageManager;
  const entry = (Array.isArray(declared) ? declared : [declared]).find(
    (candidate): candidate is { name: string; version: string } =>
      candidate?.name === manager && typeof candidate.version === "string",
  );
  return entry === undefined ? undefined : `${manager}@${entry.version}`;
}

function names(packageManager: string | undefined, manager: string): packageManager is string {
  return packageManager?.startsWith(`${manager}@`) ?? false;
}

function spec(manager: "yarn" | "pnpm", packageManager: string | undefined, release: string): string {
  return names(packageManager, manager) ? packageManager : `${manager}@${release}`;
}

function writer(rows: WriterRows, lockfileVersion: string | undefined): string {
  return (rows.find(([version]) => version === lockfileVersion) ?? rows[0])[1];
}
