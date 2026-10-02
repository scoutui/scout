/** One component in the repo-wide composition graph. */
export type CompositionGraphNode = {
  /** Component id. */
  id: string;
  displayName: string;
  packageName: string | null;
  /** Local definition path; null for externals. */
  filePath: string | null;
  scope: "external" | "local";
  deprecated: boolean;
  occurrenceCount: number;
};

/** `source` renders `target`, `count` direct call sites. Self-edges dropped. */
export type CompositionGraphEdge = { source: string; target: string; count: number };

export type CompositionGraph = {
  nodes: CompositionGraphNode[];
  edges: CompositionGraphEdge[];
};

/**
 * The part of the graph a component page shows: the component, everything
 * that renders it directly or through others, everything it renders the same
 * way, and the edges between them, in the graph's own order. An edge to a
 * node the graph doesn't hold is never followed. Empty when the component
 * isn't in the graph.
 */
export function compositionNeighbourhood(graph: CompositionGraph, componentId: string): CompositionGraph {
  const ids = new Set(graph.nodes.map(node => node.id));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const { source, target } of graph.edges) {
    if (!ids.has(source) || !ids.has(target)) continue;
    const up = parents.get(target);
    if (up) up.push(source);
    else parents.set(target, [source]);
    const down = children.get(source);
    if (down) down.push(target);
    else children.set(source, [target]);
  }
  const kept = new Set<string>();
  for (const next of [parents, children]) {
    // A Set's iterator also visits values added during the loop, so this
    // reaches every node the focus connects to in one direction.
    const reached = new Set([componentId]);
    for (const id of reached) for (const neighbour of next.get(id) ?? []) reached.add(neighbour);
    for (const id of reached) kept.add(id);
  }
  return {
    nodes: graph.nodes.filter(node => kept.has(node.id)),
    edges: graph.edges.filter(edge => kept.has(edge.source) && kept.has(edge.target)),
  };
}
