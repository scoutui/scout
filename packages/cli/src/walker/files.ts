import { globby } from "globby";

export type WalkOptions = {
  root: string;
  include: string[];
  exclude: string[];
  gitignore: boolean;
};

export async function walkFiles(opts: WalkOptions): Promise<string[]> {
  // `dot: false` skips `.next/`, `.nuxt/`, `.turbo/` and the like unless the
  // user globs them in. `suppressErrors` skips unreadable directories (EACCES)
  // instead of failing.
  const files = await globby(opts.include, {
    cwd: opts.root,
    ignore: opts.exclude,
    gitignore: opts.gitignore,
    dot: false,
    absolute: true,
    onlyFiles: true,
    suppressErrors: true,
  });
  // globby lists directories concurrently, so its order varies run to run.
  // Every later order in the scan (graph, engine, occurrences, seeds) follows
  // file order, so sort it for a deterministic artefact.
  return files.sort();
}
