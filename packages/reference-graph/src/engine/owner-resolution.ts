import type { FileGraph, Graph, Reference, UsageKind } from "../index.js";
import { MODULE_SCOPE } from "../index.js";
import type { OccurrenceVia } from "../types/occurrence-via.js";
import type { CycleGuard } from "./cycle-detection.js";
import type { ClassifiedHelperIndex } from "./helper-callers.js";

/**
 * The ownership entry for the `usageIdx`-th usage of `kind`. `ownership`
 * holds jsx and tag entries in emission order, so a Vue file that mixes the
 * two has no entry at position `usageIdx`; a file with one kind does.
 */
export function ownershipOf(
  fileGraph: FileGraph,
  kind: UsageKind,
  usageIdx: number,
): FileGraph["ownership"][number] | undefined {
  const atIndex = fileGraph.ownership[usageIdx];
  if (atIndex?.kind === kind && atIndex.usageIdx === usageIdx) return atIndex;
  return fileGraph.ownership.find((o) => o.kind === kind && o.usageIdx === usageIdx);
}

/**
 * One result of resolving an owner. `ownerDecl` is the declaring file +
 * symbol of the component-shaped ancestor (the engine will turn that into a
 * stable ComponentId). `viaPrefix` carries the helper-call hops between the
 * JSX usage and that component, outermost-first; the engine prepends it to
 * the existing viaChain.
 *
 * When `ownerDecl` is undefined the occurrence has no component ancestor and
 * falls into isRootCount.
 */
export type OwnerResolution = {
  ownerDecl?: { file: string; symbol: string };
  viaPrefix: OccurrenceVia[];
};

/**
 * Walk from a JSX usage's lexical owner symbol up the call graph until each
 * branch hits a component-shaped declaration. Branches: a helper called by N
 * components emits N results; a helper called by helpers recurses; a helper
 * with no caller chain terminating at a component emits one result with
 * `ownerDecl: undefined`.
 *
 * `helperIndex` is precomputed: the recursion only looks up the index and
 * classifies declarations, with no further graph walks inside the loop body.
 */
export function resolveOwnerChain(
  ownerRef: Reference | null,
  graph: Graph,
  helperIndex: ClassifiedHelperIndex,
  guard: CycleGuard,
): OwnerResolution[] {
  if (!ownerRef) return [{ viaPrefix: [] }];

  // Resolve the symbol's declaring file. ownerRef.originFile is the file the
  // owner was lexically observed in (parser-react sets this on every owner
  // ref). Look up the decl there.
  const file = ownerRef.originFile;
  if (!file) return [{ viaPrefix: [] }];
  const fileGraph = graph.files.get(file);
  if (!fileGraph) return [{ viaPrefix: [] }];
  const decl = fileGraph.declarations.get(`${MODULE_SCOPE}::${ownerRef.symbol}`);
  if (!decl) return [{ viaPrefix: [] }];

  const cls = helperIndex.classification(file, decl.symbol);

  if (cls === "component" || cls === "unknown") {
    return [{ ownerDecl: { file, symbol: decl.symbol }, viaPrefix: [] }];
  }

  // helper
  const callers = helperIndex.get({ file, symbol: decl.symbol });
  const hop: OccurrenceVia = { kind: "helper-call", callee: decl.symbol, calleeFile: file };

  if (!callers || callers.size === 0) {
    return [{ viaPrefix: [hop] }];
  }

  const guardResult = guard.push(file, decl.symbol);
  if (guardResult !== "ok") return [{ viaPrefix: [hop] }];

  const results: OwnerResolution[] = [];
  try {
    for (const caller of callers) {
      const callerRef: Reference = {
        symbol: caller.symbol,
        scope: MODULE_SCOPE,
        memberChain: [],
        loc: { line: 0, column: 0 },
        originFile: caller.file,
      };
      for (const sub of resolveOwnerChain(callerRef, graph, helperIndex, guard)) {
        results.push({ ...sub, viaPrefix: [hop, ...sub.viaPrefix] });
      }
    }
  } finally {
    guard.pop(file, decl.symbol);
  }
  return results.length > 0 ? results : [{ viaPrefix: [hop] }];
}
