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
 * name.
 */
export function pathValueOf(
  node: Pick<CompositionGraphNode, "scope" | "filePath" | "packageName">,
): string {
  return node.scope === "local" ? (node.filePath ?? node.packageName ?? "") : (node.packageName ?? "");
}

/**
 * The order of components at the same distance from the focus: most uses
 * against the focus first, then most uses repo-wide, then by name, then by id.
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

/** `up` follows what renders the focus; `down` follows what it renders. */
export type Dir = "up" | "down";

/** Shortest routes from the focus in one direction: steps per component, the
 *  focus at 0, and the next component toward the focus along one shortest
 *  route. */
export type Routes = { steps: Map<string, number>; toward: Map<string, string> };

/** Breadth-first from the focus, so each component settles once, at its
 *  shortest distance, and a cycle terminates. The walk never steps on a
 *  component in `blocked`. */
export function routesFrom(
  model: GraphModel,
  focusId: string,
  dir: Dir,
  blocked: ReadonlySet<string> = new Set(),
): Routes {
  const next = dir === "up" ? model.parentsOf : model.childrenOf;
  const steps = new Map<string, number>([[focusId, 0]]);
  const toward = new Map<string, string>();
  const queue = [focusId];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const { id } of next.get(cur) ?? []) {
      if (steps.has(id) || blocked.has(id)) continue;
      steps.set(id, (steps.get(cur) as number) + 1);
      toward.set(id, cur);
      queue.push(id);
    }
  }
  return { steps, toward };
}

export type BothRoutes = Record<Dir, Routes>;

export function bothRoutes(model: GraphModel, focusId: string): BothRoutes {
  return { up: routesFrom(model, focusId, "up"), down: routesFrom(model, focusId, "down") };
}

/** Ids from `id` to the focus along its shortest route, `id` first. Empty when
 *  `id` isn't reachable. */
export function routeIds(routes: Routes, focusId: string, id: string): string[] {
  const ids = [id];
  let at = id;
  while (at !== focusId) {
    const next = routes.toward.get(at);
    if (next === undefined) return [];
    ids.push(next);
    at = next;
  }
  return ids;
}

/** Nothing in the repo renders it, a self-render aside. */
export function isTopLevel(model: GraphModel, id: string): boolean {
  return !(model.parentsOf.get(id) ?? []).some((p) => p.id !== id);
}

/** The top-level components above the focus: the outer end of every route up. */
export function topLevelIds(model: GraphModel, focusId: string, up: Routes): string[] {
  return [...up.steps.keys()].filter((id) => id !== focusId && isTopLevel(model, id));
}

/** Routes up from `via` that never step on the route from `via` down to the
 *  focus, so a route through `via` can't go round a loop. */
function routesAboveVia(model: GraphModel, focusId: string, up: Routes, via: string): Routes {
  return routesFrom(model, via, "up", new Set(routeIds(up, focusId, via).slice(1)));
}

/** Top-level components a route through `via` reaches, each with its steps
 *  to the focus through `via`. `via` counts when it is top level itself. */
export function topsThrough(model: GraphModel, focusId: string, up: Routes, via: string): Map<string, number> {
  const toVia = up.steps.get(via);
  const out = new Map<string, number>();
  if (toVia === undefined) return out;
  for (const [id, steps] of routesAboveVia(model, focusId, up, via).steps) {
    if (id !== focusId && isTopLevel(model, id)) out.set(id, toVia + steps);
  }
  return out;
}

/** The route in render order, outermost first, ending at the focus: from `top`
 *  (or from `via` when no top is picked) through `via` when one is set. Empty
 *  when neither is set or no route from `top` runs through `via`. */
export function routeThrough(
  model: GraphModel,
  focusId: string,
  up: Routes,
  via: string | null,
  top: string | null,
): string[] {
  if (!via) return top ? routeIds(up, focusId, top) : [];
  const lower = routeIds(up, focusId, via);
  if (lower.length === 0) return [];
  if (!top || top === via) return lower;
  const upper = routeIds(routesAboveVia(model, focusId, up, via), via, top);
  return upper.length === 0 ? [] : [...upper.slice(0, -1), ...lower];
}

/** Uses per render edge, keyed `source>target`. */
export function edgeCounts(model: GraphModel): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of model.edges) {
    const key = `${e.source}>${e.target}`;
    counts.set(key, (counts.get(key) ?? 0) + e.count);
  }
  return counts;
}

/** Uses between `inner` (nearer the focus) and `outer`: `outer` renders
 *  `inner` going up, `inner` renders `outer` going down. */
export function usesBetween(counts: Map<string, number>, dir: Dir, inner: string, outer: string): number {
  return (dir === "up" ? counts.get(`${outer}>${inner}`) : counts.get(`${inner}>${outer}`)) ?? 0;
}

export type FindRow = {
  node: CompositionGraphNode;
  dir: Dir;
  steps: number;
  /** Names along the shortest route in render order: the outermost first. */
  chain: string[];
  /** Uses at each step of `chain`: `uses[i]` from `chain[i]` to `chain[i + 1]`. */
  uses: number[];
};

/** Every component above or below the focus, nearest first, then in
 *  `byCallSites` order. The focus is never listed, even with a self-render
 *  edge. */
export function findRows(model: GraphModel, focusId: string, routes: Routes, dir: Dir): FindRow[] {
  const counts = edgeCounts(model);
  const order = byCallSites((n) => usesBetween(counts, dir, focusId, n.id));
  const rows: FindRow[] = [];
  for (const [id, steps] of routes.steps) {
    const node = model.byId.get(id);
    if (id === focusId || !node) continue;
    const ids = routeIds(routes, focusId, id);
    if (dir === "down") ids.reverse();
    rows.push({
      node,
      dir,
      steps,
      chain: ids.map((r) => model.byId.get(r)?.displayName ?? r),
      uses: ids.slice(1).map((r, i) => counts.get(`${ids[i]}>${r}`) ?? 0),
    });
  }
  return rows.sort((a, b) => a.steps - b.steps || order(a.node, b.node));
}

/** Fewest trailing segments a path-like label may show. */
const TAIL_MIN = 2;
/** Most it may grow to. Past this the row is longer than its container can
 *  show, and the accessible name carries the full path. */
const TAIL_MAX = 6;

function tailOf(key: string, n: number): string {
  const segs = key.split("/");
  return segs.length > n ? `…/${segs.slice(-n).join("/")}` : key;
}

/**
 * Visible labels for a list of path-like values, each shortened to the fewest
 * trailing segments that make it unique within the list. Route paths share
 * deep prefixes and differ near the end, so a fixed two-segment tail shows
 * different files as the same `…/[uid]/page.tsx`.
 *
 * Identical paths stay identical: they are the same file.
 */
export function distinctTails(paths: readonly string[]): string[] {
  return paths.map((p) => {
    for (let n = TAIL_MIN; n <= TAIL_MAX; n++) {
      const mine = tailOf(p, n);
      const collides = paths.some((other) => other !== p && tailOf(other, n) === mine);
      if (!collides) return mine;
    }
    return tailOf(p, TAIL_MAX);
  });
}

/**
 * Disambiguating path fragment for each box in one diagram, or `null` when the
 * box's name is already unique, its path is empty, or every box sharing its
 * name has the same path. Boxes sharing a display name (two `ServerPage`s)
 * each get the shortest fragment that tells them apart, from `distinctTails`
 * over that group. The fragment drops the leading `…/` and, when every tail
 * ends in the same file name, that file name too: so `…/[type]/page.tsx` and
 * `…/[id]/page.tsx` become `[type]` and `[id]`.
 */
export function chipFaceFragments(chips: readonly { name: string; path: string }[]): (string | null)[] {
  const byName = new Map<string, number[]>();
  chips.forEach((c, i) => byName.set(c.name, [...(byName.get(c.name) ?? []), i]));
  const fragments: (string | null)[] = chips.map(() => null);
  for (const indices of byName.values()) {
    if (indices.length < 2) continue;
    const paths = indices.map((i) => (chips[i] as { path: string }).path);
    if (new Set(paths).size < 2) continue;
    const tails = distinctTails(paths).map((t) => t.replace(/^…\//, ""));
    const fileNames = new Set(tails.map((t) => t.slice(t.lastIndexOf("/") + 1)));
    const sameFile = fileNames.size === 1;
    indices.forEach((chipIndex, k) => {
      const tail = tails[k] as string;
      const slash = tail.lastIndexOf("/");
      const fragment = sameFile && slash > 0 ? tail.slice(0, slash) : tail;
      if (fragment !== "" && (chips[chipIndex] as { path: string }).path !== "") {
        fragments[chipIndex] = fragment;
      }
    });
  }
  return fragments;
}
