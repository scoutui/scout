import type { Graph } from "../index.js";
import { exportRecordFor, graphKeyFor } from "./binding.js";
import { effectiveExportName, residualMemberChain } from "./member-identity.js";
import { packageNameFromSpecifier } from "./specifier.js";

/**
 * Walk re-export chains (named + star) starting from `file` with the given
 * `imported` name and the member `path` read on it, returning the canonical
 * source file (where the export is locally defined), the local symbol name at
 * that leaf and the member path left to read on it.
 *
 * Mirrors what `resolveModuleExport` in `binding.ts` does for value-flow
 * resolution, applied here at identity-stamping time so JSX edges through a
 * re-export barrel attribute to the actual definition file, and two consumers
 * importing the same component through different paths (barrel vs. direct)
 * share one identity.
 *
 * Resolution priority at each hop:
 *  1. Named export of `imported` (re-export hop or local terminal).
 *  2. If absent, iterate `{kind: "star", from}` entries in source order;
 *     recurse into each source with the same `imported` name; first
 *     non-null result wins.
 *
 * A namespace hop (`import * as NS; export { NS }`, or `export * as NS from`)
 * continues into NS's module with the first segment of `path` as the name
 * and the rest as the path (`effectiveExportName`, `residualMemberChain`).
 * With an empty `path` the walk stays at the barrel's export.
 *
 * A hop through a package specifier whose target is not first-party
 * (`graph.firstParty`, absent → not first-party, as the binding resolver
 * reads it) leaves the walk: the result is that package exit, `file` being
 * the file the hop leaves from, `specifier` the package it names and
 * `exportName` the name imported from it.
 *
 * Returns null when:
 *  - The export can't be found among named exports and no star branch resolves it.
 *  - A re-export hop's `from` specifier doesn't resolve (caller falls back).
 *  - A cycle is detected (same `${file}::${imported}` revisited).
 *
 * Cycle guard uses `${file}::${imported}` pairs to bail on re-export cycles
 * including mutual `export *` (e.g. `a → export * from './b'; b → export * from './a'`).
 */
export function followReExportChain(
  graph: Graph,
  file: string,
  imported: string,
  path: readonly string[],
): ReExportLeaf | null {
  return walk(graph, file, imported, path, new Set());
}

/** Where a re-export chain ends: the file that defines the export locally, or
 *  the package the chain leaves first-party code through, with the member
 *  `path` left to read on that export. */
export type ReExportLeaf =
  | { file: string; localExport: string; path: readonly string[] }
  | { file: string; specifier: string; exportName: string; path: readonly string[] };

function walk(
  graph: Graph,
  file: string,
  imported: string,
  path: readonly string[],
  seen: Set<string>,
): ReExportLeaf | null {
  const seenKey = `${file}::${imported}`;
  // Cycle guard: revisiting the same (file, imported) means this branch has
  // already been tried. Return null so callers (including the star fallback
  // below) can try the next branch instead of receiving a synthetic non-null
  // result that misleads first-wins logic.
  if (seen.has(seenKey)) return null;
  seen.add(seenKey);
  const target = graph.files.get(file);
  if (!target) return null;

  // Step 1: named hit (default included).
  const exp = exportRecordFor(target, imported);
  if (exp) {
    // Re-export hop: recurse into the source file.
    if (exp.kind === "named" && "from" in exp) {
      const name = effectiveExportName(exp.fromImported, path);
      const rest = residualMemberChain(exp.fromImported, path);
      const nextAbs = name === "*" ? null : graph.moduleResolver(file, exp.from);
      if (!nextAbs) return { file, localExport: imported, path };
      const exit = packageExit(graph, file, nextAbs, exp.from, name, rest);
      if (exit) return exit;
      const nextKey = graphKeyFor(graph, nextAbs);
      if (!nextKey) return { file, localExport: imported, path };
      return walk(graph, nextKey, name, rest, seen) ?? { file: nextKey, localExport: name, path: rest };
    }
    // Local export: canonical source, unless the local binding is itself an
    // imported name (a barrel re-wrap):
    //   `import X from './x'; export default X`         (default-local)
    //   `import X from './x'; export { X }`             (named-local)
    //   `import X from './x'; export { X as default }`  (named-local, default name)
    //   `import * as NS from './x'; export { NS }`      (namespace, followed by its first member)
    // Follow it to the import's source. An import from a package that is not
    // first-party is a package exit. Other bare-package re-exports stay at the
    // barrel (following an external barrel to its leaf is the external-leaf
    // resolver's job), as does a namespace with no member to follow.
    if ("local" in exp) {
      const imp = target.importsByLocal.get(exp.local);
      if (imp) {
        const name = effectiveExportName(imp.imported, path);
        const rest = residualMemberChain(imp.imported, path);
        const nextAbs = name === "*" ? null : graph.moduleResolver(file, imp.specifier);
        const exit = nextAbs ? packageExit(graph, file, nextAbs, imp.specifier, name, rest) : null;
        if (exit) return exit;
        const nextKey = nextAbs && !packageNameFromSpecifier(imp.specifier) ? graphKeyFor(graph, nextAbs) : null;
        if (nextKey) {
          const leaf = walk(graph, nextKey, name, rest, seen);
          if (leaf) return leaf;
          // No leaf yet. On a lazily-parsed graph (`lazyReExportResolution`, set
          // only by the bounded definition resolver, which parses one file at a
          // time and re-walks until the landing file is parsed) return the
          // resolved key so its parse-and-retry loop can advance to it, mirroring
          // the named+from branch above. On a complete graph the flag is false and
          // a not-in-graph target is genuinely out-of-scope, so we keep the barrel
          // terminal: a rewrap never fragments onto a synthetic "default"/
          // node_modules identity.
          if (graph.lazyReExportResolution && !graph.files.has(nextKey)) {
            return { file: nextKey, localExport: name, path: rest };
          }
        }
      }
      return { file, localExport: exp.local, path };
    }
    return { file, localExport: imported, path };
  }

  // Step 2: star fallback. When `imported` is not among the file's
  // named exports, iterate {kind: "star"} entries in source order and try each
  // source for the same imported name. First branch that resolves wins. This
  // matches JS module semantics, where ambiguous wildcards are a runtime error,
  // so well-formed code has at most one resolving branch.
  for (const starExp of target.exports) {
    if (starExp.kind !== "star") continue;
    const nextAbs = graph.moduleResolver(file, starExp.from);
    if (!nextAbs) continue;
    const nextKey = graphKeyFor(graph, nextAbs);
    if (!nextKey) continue;
    const result = walk(graph, nextKey, imported, path, seen);
    if (result) return result;
  }

  return null;
}

/** The package exit of a hop from `file` whose `specifier` resolves to
 *  `targetAbs`, with the member `path` left to read on `exportName`: the hop,
 *  when the specifier names a package and the target is not first-party;
 *  else null. */
function packageExit(
  graph: Graph,
  file: string,
  targetAbs: string,
  specifier: string,
  exportName: string,
  path: readonly string[],
): ReExportLeaf | null {
  if (graph.firstParty?.(targetAbs) === true || packageNameFromSpecifier(specifier) === null) return null;
  return { file, specifier, exportName, path };
}
