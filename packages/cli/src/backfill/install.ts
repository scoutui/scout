import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type Lockfile = { dir: string; name: "pnpm-lock.yaml" | "yarn.lock" | "package-lock.json" };

/** How to install from a lockfile. `packageManagerCommand` turns `install` or `nuxtPrepare` into the command to run. */
export type InstallPlan = {
  manager: "npm" | "yarn" | "pnpm";
  spec?: string;
  install: string[];
  nuxtPrepare: string[];
  label: "npm ci" | "yarn install" | "pnpm install";
};

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
    const packageManager = found.length > 1 ? readPackageManager(dir) : undefined;
    const name = found.find((lockfile) => names(packageManager, MANAGER_OF[lockfile])) ?? found[0];
    if (name !== undefined) return { dir, name };
    if (dir === top || dirname(dir) === dir) return null;
  }
}

/** The `packageManager` field of the `package.json` in `dir`, if it has one. */
export function readPackageManager(dir: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { packageManager?: unknown } | null;
    return typeof manifest?.packageManager === "string" ? manifest.packageManager : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The install for `lockfile`, given the start of its text (`head`) and the `packageManager` beside it. Yarn and pnpm
 * use `packageManager` as written when it names them, else the release that writes the lockfile's version, else the
 * newest release listed for them.
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

/** The command that runs `plan`'s `install` or `nuxtPrepare`: the user's own `npm`, or Yarn and pnpm through Corepack. */
export function packageManagerCommand(
  plan: InstallPlan,
  step: "install" | "nuxtPrepare",
): { command: string; args: string[] } {
  if (plan.spec === undefined) return { command: "npm", args: [...plan[step]] };
  return { command: "npx", args: ["--yes", "corepack@0.36.0", plan.spec, ...plan[step]] };
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
