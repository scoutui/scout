import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { convertPathToPattern, globby } from "globby";

export type WalkOptions = {
  root: string;
  include: string[];
  exclude: string[];
  gitignore: boolean;
};

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
  return nested
    .filter((dir) => files.some((file) => file.startsWith(dir + sep)))
    .map((dir) => relative(opts.root, dir))
    .sort();
}

/** The files `include` matches below `root`, leaving out `exclude` and `ignore`. */
function globFiles(opts: WalkOptions, ignore: string[]): Promise<string[]> {
  // `dot: false` skips `.next/`, `.nuxt/`, `.turbo/` and the like unless the
  // user globs them in. `suppressErrors` skips unreadable directories (EACCES)
  // instead of failing.
  return globby(opts.include, {
    cwd: opts.root,
    ignore: [...opts.exclude, ...ignore],
    gitignore: opts.gitignore,
    dot: false,
    absolute: true,
    onlyFiles: true,
    suppressErrors: true,
  });
}
