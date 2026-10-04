import { existsSync, type Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { convertPathToPattern, globby } from "globby";

export type WalkOptions = {
  root: string;
  include: string[];
  exclude: string[];
  gitignore: boolean;
};

/** The files a config without `include` scans: every file the parsers read. */
export const DEFAULT_INCLUDE: readonly string[] = ["**/*.{js,jsx,ts,tsx,vue}"];

/** Files every scan leaves out, whatever the config says. */
export const LEFT_OUT: readonly string[] = ["**/*.{test,spec,stories}.*", "**/__tests__/**", "**/*.d.ts", "**/node_modules/**"];

/**
 * Whether `dir`, whose entries are `entries`, is a nested repository to skip:
 * a directory below `root` holding a `.git` entry (a folder for a clone, a
 * file for a submodule or a worktree) that does not contain `configDir`.
 */
export function isNestedRepository(
  dir: string,
  entries: readonly { name: string }[],
  root: string,
  configDir: string,
): boolean {
  return (
    dir !== root &&
    entries.some((entry) => entry.name === ".git") &&
    configDir !== dir &&
    !configDir.startsWith(dir + sep)
  );
}

/**
 * Every nested repository below `root`, taking `root` as the config's folder.
 * `node_modules` and dot folders are not searched, and symlinks are not
 * followed.
 */
async function nestedRepositories(root: string): Promise<string[]> {
  const found: string[] = [];
  const search = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch((): Dirent[] => []);
    if (isNestedRepository(dir, entries, root, root)) {
      found.push(dir);
      return;
    }
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith("."))
        .map((entry) => search(join(dir, entry.name))),
    );
  };
  await search(root);
  return found;
}

export async function walkFiles(opts: WalkOptions): Promise<string[]> {
  const nested = await nestedRepositories(opts.root);
  const files = await globFiles(opts, nested.map((dir) => `${convertPathToPattern(relative(opts.root, dir))}/**`));
  // globby lists directories concurrently, so its order varies run to run.
  // Every later order in the scan (graph, engine, occurrences, seeds) follows
  // file order, so sort it for a deterministic artefact.
  return files.sort();
}

/**
 * The nested repositories below `root` that hold a file `include` matches,
 * relative to `root` and sorted.
 */
export async function nestedRepositoriesMatched(opts: WalkOptions): Promise<string[]> {
  const nested = await nestedRepositories(opts.root);
  if (nested.length === 0) return [];
  const files = await globFiles(opts, []);
  const inside = (dir: string, file: string): boolean => {
    const path = relative(dir, file);
    return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
  };
  return nested
    .filter((dir) => files.some((file) => inside(dir, file)))
    .map((dir) => relative(opts.root, dir))
    .sort();
}

/**
 * The `exclude` entries with no glob characters whose path, resolved from
 * `root`, doesn't exist, in config order.
 */
export function excludeEntriesMatchingNothing(root: string, exclude: readonly string[]): string[] {
  return exclude.filter((entry) => !/[*?[\]{}!]/.test(entry) && !existsSync(resolve(root, entry)));
}

/** The files `include` matches below `root`, leaving out `LEFT_OUT`, `exclude` and `ignore`. */
function globFiles(opts: WalkOptions, ignore: string[]): Promise<string[]> {
  // `dot: false` skips `.next/`, `.nuxt/`, `.turbo/` and the like unless the
  // user globs them in. `suppressErrors` skips unreadable directories (EACCES)
  // instead of failing.
  return globby(opts.include, {
    cwd: opts.root,
    ignore: [...LEFT_OUT, ...opts.exclude, ...ignore],
    gitignore: opts.gitignore,
    dot: false,
    absolute: true,
    onlyFiles: true,
    suppressErrors: true,
  });
}
