import type { Graph } from "../index.js";
import { exportRecordFor, graphKeyFor } from "./binding.js";
import { packageNameFromSpecifier } from "./specifier.js";

/**
 * Walk re-export chains (named + star) starting from `file` with the given
 * `imported` name, returning the canonical source file (where the export is
 * locally defined) and the local symbol name at that leaf.
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
): ReExportLeaf | null {
  return walk(graph, file, imported, new Set());
}

/** Where a re-export chain ends: the file that defines the export locally, or
 *  the package the chain leaves first-party code through. */
export type ReExportLeaf =
  | { file: string; localExport: string }
  | { file: string; specifier: string; exportName: string };

function walk(
  graph: Graph,
  file: string,
  imported: string,
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
      const nextAbs = graph.moduleResolver(file, exp.from);
      if (!nextAbs) return { file, localExport: imported };
      const exit = packageExit(graph, file, nextAbs, exp.from, exp.fromImported);
      if (exit) return exit;
      const nextKey = graphKeyFor(graph, nextAbs);
      if (!nextKey) return { file, localExport: imported };
      return walk(graph, nextKey, exp.fromImported, seen) ?? {
        file: nextKey,
        localExport: exp.fromImported,
      };
    }
    // Local export: canonical source, unless the local binding is itself an
    // imported name (a barrel re-wrap):
    //   `import X from './x'; export default X`         (default-local)
    //   `import X from './x'; export { X }`             (named-local)
    //   `import X from './x'; export { X as default }`  (named-local, default name)
    // Follow it to the import's source. An import from a package that is not
    // first-party is a package exit. Other bare-package re-exports stay at the
    // barrel (following an external barrel to its leaf is the external-leaf
    // resolver's job), as do namespace re-exports (`import * as NS`).
    if ("local" in exp) {
      const imp = target.importsByLocal.get(exp.local);
      const nextAbs = imp && imp.imported !== "*" ? graph.moduleResolver(file, imp.specifier) : null;
      const exit = imp && nextAbs ? packageExit(graph, file, nextAbs, imp.specifier, imp.imported) : null;
      if (exit) return exit;
      if (imp && imp.imported !== "*" && !packageNameFromSpecifier(imp.specifier)) {
        const nextKey = nextAbs ? graphKeyFor(graph, nextAbs) : null;
        if (nextKey) {
          const leaf = walk(graph, nextKey, imp.imported, seen);
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
            return { file: nextKey, localExport: imp.imported };
          }
        }
      }
      return { file, localExport: exp.local };
    }
    return { file, localExport: imported };
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
    const result = walk(graph, nextKey, imported, seen);
    if (result) return result;
  }

  return null;
}

/** The package exit of a hop from `file` whose `specifier` resolves to
 *  `targetAbs`: the hop, when the specifier names a package and the target is
 *  not first-party; else null. */
function packageExit(
  graph: Graph,
  file: string,
  targetAbs: string,
  specifier: string,
  exportName: string,
): ReExportLeaf | null {
  if (graph.firstParty?.(targetAbs) === true || packageNameFromSpecifier(specifier) === null) return null;
  return { file, specifier, exportName };
}
