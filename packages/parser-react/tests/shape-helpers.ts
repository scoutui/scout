/**
 * Shared pipeline helper for the engine-shape tests.
 *
 * Each shape test runs the real pipeline: oxc parse, then emitReact
 * (structural AST → graph), then resolve (graph → occurrences). A hand-built
 * graph can pass while the arm under test is dead on real parser output.
 */
import { posix } from "node:path";
import { parseSync } from "oxc-parser";
import { createGraphBuilder, resolve, type GraphHostHooks, type ResolveOpts } from "@scoutui/reference-graph";
import { emitReact } from "../src/emit.js";

/**
 * Resolves a relative specifier against the importing file, the way a real
 * resolver does, so a fixture with more than one folder resolves correctly.
 * The builder hands `from` in absolute form; a relative `from` resolves
 * against `repoRoot`. Bare specifiers stay unresolved.
 */
export function pathResolver(repoRoot: string) {
  return (from: string, spec: string): string | null =>
    spec.startsWith(".") ? posix.resolve(repoRoot, posix.dirname(from), spec) : null;
}

/** The built `Graph`, for asserting on what the parser emitted. */
export function buildGraph(
  files: Record<string, string>,
  moduleResolver: (from: string, spec: string) => string | null = () => null,
  repoRoot?: string,
) {
  const gb = createGraphBuilder({ moduleResolver, ...(repoRoot !== undefined ? { repoRoot } : {}) });
  for (const [path, source] of Object.entries(files)) {
    const fb = gb.beginFile(path);
    emitReact({ file: path, source, ast: parseSync(path, source).program, fileBuilder: fb });
  }
  return gb.build();
}

/** Full `ResolvedGraph` (occurrences + the narrowed roster registry). */
export function scanGraph(
  files: Record<string, string>,
  moduleResolver: (from: string, spec: string) => string | null = () => null,
  repoRoot?: string,
  opts?: ResolveOpts,
  hooks?: GraphHostHooks,
) {
  const gb = createGraphBuilder({ moduleResolver, ...(repoRoot !== undefined ? { repoRoot } : {}) });
  for (const [path, source] of Object.entries(files)) {
    const fb = gb.beginFile(path);
    emitReact({ file: path, source, ast: parseSync(path, source).program, fileBuilder: fb });
  }
  return resolve(gb.build(hooks), opts);
}

export function scan(
  files: Record<string, string>,
  moduleResolver: (from: string, spec: string) => string | null = () => null,
  repoRoot?: string,
  opts?: ResolveOpts,
  hooks?: GraphHostHooks,
) {
  return scanGraph(files, moduleResolver, repoRoot, opts, hooks).occurrences;
}

/** Resolves `./Name` to `<repoRoot>/src/Name.tsx`; bare specifiers stay unresolved. */
export function relResolver(repoRoot: string) {
  return (_from: string, spec: string): string | null =>
    spec.startsWith("./") ? `${repoRoot}/src/${spec.slice(2)}.tsx` : null;
}

/** 1-based number of the first line of `source` that contains `needle`. */
export function lineOf(source: string, needle: string): number {
  const at = source.split("\n").findIndex((l) => l.includes(needle));
  if (at < 0) throw new Error(`no line contains ${needle}`);
  return at + 1;
}

/** 1-based column of `ident` on the first line containing `lineNeedle` (the last match when `last`). */
export function columnOf(source: string, lineNeedle: string, ident: string, last = false): number {
  const line = source.split("\n").find((l) => l.includes(lineNeedle));
  if (line === undefined) throw new Error(`no line contains ${lineNeedle}`);
  const at = last ? line.lastIndexOf(ident) : line.indexOf(ident);
  if (at < 0) throw new Error(`${ident} is not on the line containing ${lineNeedle}`);
  return at + 1;
}

/** Flattens rawComponentId for order-independent assertions. */
export function idsOf(occs: ReturnType<typeof scan>) {
  return occs.map((o) => {
    const id = o.rawComponentId as {
      export?: string;
      source?: { type: string; package?: string; filePath?: string };
    };
    return {
      export: id.export,
      package: id.source?.package,
      filePath: id.source?.filePath,
      via: o.via?.kind,
    };
  });
}
