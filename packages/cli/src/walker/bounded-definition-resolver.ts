/**
 * Pin the identity of an un-walked workspace-member import to its definition
 * file, so identity is the same in whole-root and sub-package scans.
 *
 * Keeps a private shadow graph of only the chain files, parsed on demand, and
 * re-runs `followReExportChain` until the landing file is one it has parsed or
 * `maxFiles` is hit. The walk follows a namespace re-export down the member
 * path, so a member of a namespace is pinned where that member is declared.
 * For a named re-export, `followReExportChain` returns the hop target when
 * that file is absent from the graph: the file to parse next.
 * For `export *` it returns null when the intermediate barrel isn't parsed
 * yet, so a stalled walk parses one more first-party star target (read from
 * the graph's `exports`) and retries. Files parsed here are never walked for
 * occurrences, props or composition: they only pin identity and answer
 * `declarationOf` for the definition pinned.
 *
 * The shadow graph is built with no `repoRoot`, so it has no
 * `resolveToGraphKey`; `followReExportChain` hops therefore stay absolute,
 * matching the `moduleResolver` output and the shadow-graph file keys. It
 * carries the host's `firstParty`, so a chain that leaves first-party code
 * through a package import or `export *` ends at that package export.
 */
import { readFileSync } from "node:fs";
import {
  createGraphBuilder,
  declarationOf,
  declarationPositionIn,
  followReExportChain,
} from "@scoutui/reference-graph";
import type { Graph, ResolveImport } from "@scoutui/reference-graph";
import { emitReact } from "@scoutui/parser-react";
import { parseByExt, type ParsedFile, type SyntaxErrorReporter } from "../parse-by-ext.js";
import { emitVueFile } from "../emit-vue-file.js";

export type BoundedDefinitionResolver = {
  /** The graph's `resolveLocalDefinition` hook: the definition file and
   *  export name an unparsed file's import lands on and the member path left
   *  past it, with where that export, followed down that path, is declared
   *  there; the package export it leaves first-party code through; or null. */
  resolveDefinition: NonNullable<Graph["resolveLocalDefinition"]>;
  /** The registry's `declarationOf` over the files this resolver parsed. */
  declarationOf: (absFile: string, exportName: string) => ReturnType<typeof declarationOf>;
};

type Pinned =
  | { absFile: string; exportName: string; path: readonly string[] }
  | { fromFile: string; specifier: string; exportName: string; path: readonly string[] };

export function createBoundedDefinitionResolver(opts: {
  moduleResolver: ResolveImport;
  firstParty: NonNullable<Graph["firstParty"]>;
  maxFiles?: number;
  onWarning?: (msg: string) => void;
  /** Syntax errors the parser recovered from in a file this resolver reads. */
  onSyntaxErrors?: SyntaxErrorReporter;
}): BoundedDefinitionResolver {
  const maxFiles = opts.maxFiles ?? 10;
  const memo = new Map<string, Pinned | null>();
  // Keyed by absolute paths (no repoRoot). `lazyReExportResolution` lets the
  // parse-and-retry loop follow barrels that re-wrap imported locals to the
  // leaf, as the whole-graph walk does.
  const builder = createGraphBuilder({ moduleResolver: opts.moduleResolver, lazyReExportResolution: true });
  const parsed = new Set<string>();
  const shadowGraph = (): Graph => builder.build({ firstParty: opts.firstParty });

  const tryParse = (absFile: string): boolean => {
    if (parsed.has(absFile)) return true;
    let source: string;
    try {
      source = readFileSync(absFile, "utf8");
    } catch {
      return false;
    }
    let file: ParsedFile;
    try {
      file = parseByExt(absFile, source, opts.onSyntaxErrors);
    } catch {
      return false;
    }
    if (file.kind === "unsupported") return false;
    try {
      if (file.kind === "vue") {
        emitVueFile({ graphBuilder: builder, graphKey: absFile, definitionPath: absFile, parsed: file });
      } else {
        const fb = builder.beginFile(absFile);
        emitReact({ file: absFile, source, ast: file.ast, fileBuilder: fb });
      }
    } catch {
      return false;
    }
    parsed.add(absFile);
    return true;
  };

  // Parse one not-yet-parsed first-party `export *` target reachable from an
  // already-parsed file. `followReExportChain` recurses into star sources
  // internally and returns null (rather than a hop target) when the source file
  // is absent from the graph, so a stalled named walk needs this to advance the
  // star frontier. Returns true when it parsed a new file. Star `from`
  // specifiers resolve from the parsed file's own absolute key.
  const expandStarFrontier = (): boolean => {
    const graph = shadowGraph();
    for (const [fileKey, fileGraph] of graph.files) {
      for (const exp of fileGraph.exports) {
        if (exp.kind !== "star") continue;
        const targetAbs = opts.moduleResolver(fileKey, exp.from);
        if (!targetAbs || parsed.has(targetAbs) || !opts.firstParty(targetAbs)) continue;
        if (tryParse(targetAbs)) return true;
      }
    }
    return false;
  };

  const pin = (absTarget: string, imported: string, path: readonly string[]): Pinned | null => {
    const key = [absTarget, imported, ...path].join("\0");
    const hit = memo.get(key);
    if (hit !== undefined) return hit;

    let result: Pinned | null = null;
    if (tryParse(absTarget)) {
      let filesUsed = 1;
      for (;;) {
        const chained = followReExportChain(shadowGraph(), absTarget, imported, path);
        if (chained && "specifier" in chained) {
          result = { fromFile: chained.file, specifier: chained.specifier, exportName: chained.exportName, path: chained.path };
          break;
        }
        if (chained) {
          if (parsed.has(chained.file)) {
            result = { absFile: chained.file, exportName: chained.localExport, path: chained.path };
            break;
          }
          if (filesUsed >= maxFiles || !tryParse(chained.file)) {
            // Cap or unparseable hop: best-effort pin to the named hop target.
            opts.onWarning?.(`Stopped following re-exports of "${imported}" at ${chained.file}, so its occurrences are counted under that file.`);
            result = { absFile: chained.file, exportName: chained.localExport, path: chained.path };
            break;
          }
          filesUsed++;
          continue;
        }
        // Named walk stalled. An unparsed star barrel may still hold the name:
        // parse one star target and retry. With none left, the caller falls
        // back to absTarget.
        if (filesUsed >= maxFiles) break;
        if (!expandStarFrontier()) break;
        filesUsed++;
      }
    }
    memo.set(key, result);
    return result;
  };

  const resolveDefinition: BoundedDefinitionResolver["resolveDefinition"] = (absTarget, imported, path) => {
    const pinned = pin(absTarget, imported, path);
    if (pinned === null || "specifier" in pinned) return pinned;
    const definition = declarationPositionIn(shadowGraph(), pinned.absFile, pinned.exportName, pinned.path);
    return definition === undefined ? pinned : { ...pinned, definition };
  };

  return {
    resolveDefinition,
    declarationOf: (absFile, exportName) => declarationOf(shadowGraph(), absFile, exportName),
  };
}
