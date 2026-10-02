/**
 * Global CEM (Custom Elements Manifest) index, built once at scan startup.
 *
 * Finds every package installed in the repository, reads the CEM a package
 * declares through `package.json#customElements`, and maps each canonical tag
 * name to every package's claim on it (`byTag`).
 */
import { lstat, readdir, readFile, readlink, realpath } from "node:fs/promises";
import { existsSync, type Dirent } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { canonicalTagName } from "@scoutui/reference-graph";

/** One package's claim on a tag in `CemIndex.byTag`, with the installed version. */
export type CemIndexEntry = { packageName: string; version: string | null };

export type CemIndex = {
  /** Canonical tag name → one claim per package, ordered by package name. */
  byTag: Map<string, CemIndexEntry[]>;
};

type CemDecl = {
  customElement?: boolean;
  tagName?: string;
  [key: string]: unknown;
};

type CemJson = {
  modules?: Array<{
    declarations?: CemDecl[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

/** The tag names of a CEM document's custom-element declarations. */
function cemTagNames(cem: CemJson): string[] {
  const results: string[] = [];
  for (const mod of cem.modules ?? []) {
    for (const decl of mod.declarations ?? []) {
      if (decl.customElement === true && typeof decl.tagName === "string") results.push(decl.tagName);
    }
  }
  return results;
}

/** A directory's entries; none when it can't be read. */
const entriesOf = (dir: string): Promise<Dirent[]> => readdir(dir, { withFileTypes: true }).catch(() => []);

/** Visits every entry of `dir` concurrently. */
async function eachEntry(dir: string, visit: (entry: Dirent, path: string) => Promise<void> | undefined): Promise<void> {
  await Promise.all((await entriesOf(dir)).map((entry) => visit(entry, join(dir, entry.name))));
}

type Install = { path: string; isLink: boolean };

/**
 * Every package installed in a `node_modules` directory at any depth under
 * `root`: each `node_modules/<name>` and `node_modules/@scope/<name>` entry,
 * a directory or a symlink, including pnpm's store entries
 * `node_modules/.pnpm/<id>/node_modules/<name>`. The symlinks beside a store
 * entry are its dependencies, each a store entry itself, so they are skipped.
 *
 * Outside `node_modules` the whole tree is walked, except `.git` and any
 * nested repository (a directory below `root` holding a `.git` entry: a clone,
 * a worktree, a submodule) that does not contain `configDir`. Inside it, only
 * a package directory's own nested `node_modules` is walked. A symlink is
 * listed but never descended into.
 */
async function installsUnder(root: string, configDir: string): Promise<Install[]> {
  const installs: Install[] = [];
  const walkTree = async (dir: string): Promise<void> => {
    const entries = await entriesOf(dir);
    const nestedRepository = dir !== root && entries.some((entry) => entry.name === ".git");
    if (nestedRepository && configDir !== dir && !configDir.startsWith(dir + sep)) return;
    await Promise.all(
      entries.map((entry) => {
        if (!entry.isDirectory() || entry.name === ".git") return undefined;
        const path = join(dir, entry.name);
        return entry.name === "node_modules" ? walkNodeModules(path) : walkTree(path);
      }),
    );
  };
  const walkNodeModules = (dir: string, inStore = false): Promise<void> =>
    eachEntry(dir, (entry, path) => {
      if (entry.name === ".pnpm") {
        if (!entry.isDirectory()) return undefined;
        return eachEntry(path, (storeEntry, storePath) =>
          storeEntry.isDirectory() ? walkNodeModulesIn(storePath, true) : undefined,
        );
      }
      if (entry.name.startsWith("@")) {
        return entry.isDirectory() ? eachEntry(path, (scoped, pkg) => addPackage(scoped, pkg, inStore)) : undefined;
      }
      return entry.name.startsWith(".") ? undefined : addPackage(entry, path, inStore);
    });
  const addPackage = async (entry: Dirent, path: string, inStore: boolean): Promise<void> => {
    if (entry.isSymbolicLink()) {
      if (!inStore) installs.push({ path, isLink: true });
    } else if (entry.isDirectory()) {
      installs.push({ path, isLink: false });
      await walkNodeModulesIn(path, false);
    }
  };
  const walkNodeModulesIn = async (dir: string, inStore: boolean): Promise<void> => {
    const nested = join(dir, "node_modules");
    if ((await lstat(nested).catch(() => null))?.isDirectory()) await walkNodeModules(nested, inStore);
  };
  await walkTree(root);
  return installs;
}

/**
 * The realpath of the package a symlink installs; null when the link is
 * broken. A `walked` directory's path is its realpath (the walk starts from a
 * realpath and never descends a symlink), so a link whose target resolves to
 * one needs no further resolution.
 */
async function linkedRealpath(link: string, walked: ReadonlySet<string>): Promise<string | null> {
  try {
    const target = resolve(dirname(link), await readlink(link));
    return walked.has(target) ? target : await realpath(link);
  } catch {
    return null;
  }
}

/** Sort key of an install; lower keys stand first for their package's version. */
type InstallRank = [onLookupPath: number, distance: number, path: string];

const segments = (path: string): number => path.split(sep).filter((segment) => segment !== "").length;

/**
 * An install on `configDir`'s lookup path (in the `node_modules` of
 * `configDir` or one of its ancestors) ranks first, nearest first. Every other
 * install ranks after, shallowest first, then by path.
 */
function installRank(root: string, configDir: string, path: string): InstallRank {
  const base = path.slice(0, path.lastIndexOf(`${sep}node_modules${sep}`));
  const rel = relative(root, path);
  if (configDir === base || configDir.startsWith(base + sep)) return [0, segments(configDir) - segments(base), rel];
  return [1, segments(rel), rel];
}

function compareRank(a: InstallRank, b: InstallRank): number {
  return a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
}

type PackageCem = { packageName: string; version: string | null; cem: CemJson };

/**
 * The CEM the package in `dir` declares through `package.json#customElements`;
 * null when it declares none, the CEM is missing or malformed, or the
 * package.json is unreadable or unnamed.
 */
async function readPackageCem(dir: string): Promise<PackageCem | null> {
  let pkg: { name?: unknown; version?: unknown; customElements?: unknown };
  try {
    const text = await readFile(join(dir, "package.json"), "utf8");
    if (!text.includes('"customElements"')) return null;
    pkg = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof pkg.name !== "string" || typeof pkg.customElements !== "string") return null;
  const cemPath = join(dir, pkg.customElements);
  if (!existsSync(cemPath)) return null;
  try {
    const cem = JSON.parse(await readFile(cemPath, "utf8")) as CemJson;
    return { packageName: pkg.name, version: typeof pkg.version === "string" ? pkg.version : null, cem };
  } catch {
    // Malformed CEM: skip.
    return null;
  }
}

/** How many packages `readPackageCems` reads at once; each read holds a file descriptor open. */
const READERS = 64;

/** `readPackageCem` for every directory, in order, at most `READERS` at a time. */
async function readPackageCems(dirs: readonly string[]): Promise<(PackageCem | null)[]> {
  const results: (PackageCem | null)[] = dirs.map(() => null);
  const queue = dirs.entries();
  const reader = async (): Promise<void> => {
    for (const [i, dir] of queue) results[i] = await readPackageCem(dir);
  };
  await Promise.all(Array.from({ length: Math.min(READERS, dirs.length) }, reader));
  return results;
}

/**
 * Build a global CEM index from every package installed in the repository at
 * `root` (see `installsUnder`), never above it. Yarn workspace and pnpm
 * packages are symlinked into `node_modules`, so they are indexed alongside
 * published dependencies. A symlinked package is read through its link, even
 * when the link points outside `root`.
 *
 * Only a package that declares its CEM through `package.json#customElements`
 * is indexed. Each package directory is read once, by realpath. Each
 * declaration with a `tagName` adds its package's claim to `byTag` under the
 * canonical tag name, once per package name. When one package name is
 * installed more than once, the claim's version comes from the install that
 * ranks first among those declaring the tag: the one Node resolves from
 * `configDir` (the nearest on its lookup path), else the shallowest under
 * `root`, then by path.
 */
export async function buildCemIndex(input: { root: string; configDir: string }): Promise<CemIndex> {
  const root = await realpath(input.root);
  const configDir = await realpath(input.configDir);

  const installs = await installsUnder(root, configDir);
  const walked = new Set(installs.flatMap(({ path, isLink }) => (isLink ? [] : [path])));
  const realpaths = await Promise.all(
    installs.map(({ path, isLink }) => (isLink ? linkedRealpath(path, walked) : path)),
  );
  const rankByRealpath = new Map<string, InstallRank>();
  installs.forEach(({ path }, i) => {
    const real = realpaths[i];
    if (real === null || real === undefined) return;
    const rank = installRank(root, configDir, path);
    const best = rankByRealpath.get(real);
    if (best === undefined || compareRank(rank, best) < 0) rankByRealpath.set(real, rank);
  });
  const ranked = [...rankByRealpath].sort(([, a], [, b]) => compareRank(a, b));

  const index: CemIndex = { byTag: new Map() };
  for (const found of await readPackageCems(ranked.map(([dir]) => dir))) {
    if (found === null) continue;
    const { packageName, version, cem } = found;
    for (const tagName of cemTagNames(cem)) {
      const tag = canonicalTagName(tagName);
      const claims = index.byTag.get(tag) ?? [];
      if (claims.some((c) => c.packageName === packageName)) continue;
      claims.push({ packageName, version });
      index.byTag.set(tag, claims);
    }
  }
  for (const claims of index.byTag.values()) {
    claims.sort((a, b) => (a.packageName < b.packageName ? -1 : a.packageName > b.packageName ? 1 : 0));
  }

  return index;
}
