import type {
  CompositionGraph,
  CompositionGraphEdge,
  CompositionGraphNode,
} from "@scoutui/web-shared";

export type GraphAdjacency = { id: string; count: number };

export type GraphModel = {
  byId: Map<string, CompositionGraphNode>;
  /** renderedBy direction: node → components that render it. */
  parentsOf: Map<string, GraphAdjacency[]>;
  /** renders direction: node → components it renders. */
  childrenOf: Map<string, GraphAdjacency[]>;
  edges: CompositionGraphEdge[];
};

export function buildGraphModel(graph: CompositionGraph): GraphModel {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const parentsOf = new Map<string, GraphAdjacency[]>();
  const childrenOf = new Map<string, GraphAdjacency[]>();
  for (const e of graph.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    const children = childrenOf.get(e.source);
    if (children) children.push({ id: e.target, count: e.count });
    else childrenOf.set(e.source, [{ id: e.target, count: e.count }]);
    const parents = parentsOf.get(e.target);
    if (parents) parents.push({ id: e.source, count: e.count });
    else parentsOf.set(e.target, [{ id: e.source, count: e.count }]);
  }
  return { byId, parentsOf, childrenOf, edges: graph.edges };
}

/**
 * A node's path-like display value: local nodes show their file path, or the
 * package name when the file path is unset; external nodes show their package
 * name. Chip tooltips, chip accessible names, rail rows and member-panel rows
 * all read it.
 */
export function pathValueOf(
  node: Pick<CompositionGraphNode, "scope" | "filePath" | "packageName">,
): string {
  return node.scope === "local" ? (node.filePath ?? node.packageName ?? "") : (node.packageName ?? "");
}

export type TraceEndpoint = { node: CompositionGraphNode; hops: number };

function bfs(
  start: string,
  next: Map<string, GraphAdjacency[]>,
): Map<string, number> {
  const dist = new Map<string, number>([[start, 0]]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    const d = dist.get(cur) as number;
    for (const { id } of next.get(cur) ?? []) {
      if (!dist.has(id)) {
        dist.set(id, d + 1);
        queue.push(id);
      }
    }
  }
  return dist;
}

/**
 * Everything above the focus (`up`, following parents) or below it (`down`,
 * following children), each row with the fewest steps between it and the
 * focus. The focus is never in its own list, even with a self-render edge, and
 * a cycle terminates: BFS settles every id once, at its shortest distance.
 *
 * Ordered nearest first, then by `byCallSites` (only 1-step rows have call
 * sites against the focus).
 */
export function closureOf(
  model: GraphModel,
  focusId: string,
  direction: "up" | "down",
): TraceEndpoint[] {
  const next = direction === "up" ? model.parentsOf : model.childrenOf;
  const callSites = new Map((next.get(focusId) ?? []).map((a) => [a.id, a.count]));
  const order = byCallSites((n) => callSites.get(n.id) ?? 0);
  const rows: TraceEndpoint[] = [];
  for (const [id, hops] of bfs(focusId, next)) {
    if (id === focusId) continue;
    const node = model.byId.get(id);
    if (node) rows.push({ node, hops });
  }
  return rows.sort((a, b) => a.hops - b.hops || order(a.node, b.node));
}

/**
 * The order of components at the same distance from the focus, shared by the
 * lists and the render tree's columns: most call sites against the focus
 * first, then most call sites repo-wide, then by name, then by id.
 */
export function byCallSites(
  callSitesAgainstFocus: (node: CompositionGraphNode) => number,
): (a: CompositionGraphNode, b: CompositionGraphNode) => number {
  return (a, b) =>
    callSitesAgainstFocus(b) - callSitesAgainstFocus(a) ||
    b.occurrenceCount - a.occurrenceCount ||
    a.displayName.localeCompare(b.displayName) ||
    a.id.localeCompare(b.id);
}

/** Min-hop path from `from` to `to` following `next` adjacency. Ids ordered from→to; null when unreachable. */
export function pathBetween(
  model: GraphModel,
  from: string,
  to: string,
  next: Map<string, GraphAdjacency[]>,
): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const { id } of next.get(cur) ?? []) {
      if (prev.has(id)) continue;
      prev.set(id, cur);
      if (id === to) {
        const path = [to];
        let step = to;
        while (step !== from) {
          step = prev.get(step) as string;
          path.push(step);
        }
        return path.reverse();
      }
      queue.push(id);
    }
  }
  return null;
}
