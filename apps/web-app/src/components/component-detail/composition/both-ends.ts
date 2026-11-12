import type { CompositionGraphNode } from "@scoutui/web-shared";
import {
  byCallSites,
  chipFaceFragments,
  edgeCounts,
  isTopLevel,
  pathValueOf,
  routeIds,
  routeThrough,
  topLevelIds,
  topsThrough,
  usesBetween,
  type BothRoutes,
  type Dir,
  type GraphModel,
} from "./graph-model";

/** What's picked: `pin` is the component a route on the rendered-by side runs
 *  through, or the far end of a route on the renders side; `top` is the
 *  top-level component a route on the rendered-by side starts from. */
export type Ends = { pin: { dir: Dir; id: string } | null; top: string | null };
export const NO_ENDS: Ends = { pin: null, top: null };

export type EndRow = {
  node: CompositionGraphNode;
  /** Tells same-named components apart; null when the name is unique. */
  fragment: string | null;
  /** Steps to the focus, through the picked component when one is set. */
  steps: number;
  /** Uses between it and the focus, for the components one step away. */
  uses: number;
};

export type BothEnds = {
  focus: CompositionGraphNode;
  /** The top-level components above the focus, or those a route through
   *  `through` reaches; fewest steps first, then by name. */
  top: EndRow[];
  /** Top-level components above the focus with nothing picked. */
  topTotal: number;
  /** The component the route runs through, when one is picked above the focus. */
  through: CompositionGraphNode | null;
  /** What renders the focus directly, most uses first. */
  direct: EndRow[];
  /** What the focus renders directly, most uses first. */
  renders: EndRow[];
  /** The route drawn, in render order, the focus included; no ids when none. */
  route: { dir: Dir; ids: string[] };
  /** The route's components drawn as boxes: all but the focus, the row next
   *  to it and the top-level row it starts from. */
  between: EndRow[];
  /** The rows the route runs through in each list. */
  picked: { top: string | null; direct: string | null; renders: string | null };
  /** Components above and below the focus, at any number of steps. */
  totals: { up: number; down: number };
};

/** Drops picks the graph can't draw: a pin it doesn't reach, a top that isn't
 *  top level or that no route through the pin reaches. A top-level pin above
 *  the focus becomes the top. */
export function normaliseEnds(model: GraphModel, focusId: string, routes: BothRoutes, ends: Ends): Ends {
  let pin = ends.pin && ends.pin.id !== focusId && routes[ends.pin.dir].steps.has(ends.pin.id) ? ends.pin : null;
  if (pin?.dir === "down") return { pin, top: null };
  let top = ends.top;
  if (pin && isTopLevel(model, pin.id)) {
    top = pin.id;
    pin = null;
  }
  if (top !== null && (top === focusId || !routes.up.steps.has(top) || !isTopLevel(model, top))) top = null;
  if (top !== null && pin && !topsThrough(model, focusId, routes.up, pin.id).has(top)) top = null;
  return { pin, top };
}

/** Picks a top-level component, or drops it when it's picked already. */
export function pickTop(ends: Ends, id: string): Ends {
  return { pin: ends.pin?.dir === "up" ? ends.pin : null, top: ends.top === id ? null : id };
}

/** Picks a direct renderer for the route to run through, or drops it when
 *  it's picked already. The top stays when a route through it reaches the top. */
export function pickDirect(model: GraphModel, focusId: string, routes: BothRoutes, ends: Ends, id: string): Ends {
  if (ends.pin?.dir === "up" && ends.pin.id === id) return { pin: null, top: ends.top };
  const top = ends.top !== null && topsThrough(model, focusId, routes.up, id).has(ends.top) ? ends.top : null;
  return { pin: { dir: "up", id }, top };
}

/** What a component picked in Find becomes: the top when it's top level, else
 *  the component the route runs through, or the far end of a route below. */
export function pickFound(model: GraphModel, dir: Dir, id: string): Ends {
  return dir === "up" && isTopLevel(model, id) ? { pin: null, top: id } : { pin: { dir, id }, top: null };
}

/** A name in the pieces it may wrap between: before a capital that follows a
 *  lower-case letter or a digit, and after `/`, `-`, `_` and `.`. */
export function nameBreaks(name: string): string[] {
  return name.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[/\-_.])/).filter(Boolean);
}

export function buildBothEnds(model: GraphModel, focusId: string, routes: BothRoutes, ends: Ends): BothEnds {
  const counts = edgeCounts(model);
  const nodeOf = (id: string) => model.byId.get(id) as CompositionGraphNode;
  const all = [...new Set([...routes.up.steps.keys(), ...routes.down.steps.keys()])];
  const fragments = chipFaceFragments(all.map((id) => ({ name: nodeOf(id).displayName, path: pathValueOf(nodeOf(id)) })));
  const fragmentOf = new Map(all.map((id, i) => [id, fragments[i] ?? null]));
  const row = (id: string, steps: number, uses: number): EndRow => ({
    node: nodeOf(id),
    fragment: fragmentOf.get(id) ?? null,
    steps,
    uses,
  });
  const near = (dir: Dir): EndRow[] =>
    [...routes[dir].steps]
      .filter(([id, steps]) => steps === 1 && id !== focusId)
      .map(([id]) => nodeOf(id))
      .sort(byCallSites((n) => usesBetween(counts, dir, focusId, n.id)))
      .map((n) => row(n.id, 1, usesBetween(counts, dir, focusId, n.id)));

  const via = ends.pin?.dir === "up" ? ends.pin.id : null;
  const tops = topLevelIds(model, focusId, routes.up);
  const stepsOf = via
    ? topsThrough(model, focusId, routes.up, via)
    : new Map(tops.map((id) => [id, routes.up.steps.get(id) as number]));
  const top = [...stepsOf]
    .map(([id, steps]) => row(id, steps, 0))
    .sort(
      (a, b) =>
        a.steps - b.steps || a.node.displayName.localeCompare(b.node.displayName) || a.node.id.localeCompare(b.node.id),
    );

  const route: BothEnds["route"] =
    ends.pin?.dir === "down"
      ? { dir: "down", ids: routeIds(routes.down, focusId, ends.pin.id).reverse() }
      : { dir: "up", ids: routeThrough(model, focusId, routes.up, via, ends.top) };
  const r = route.ids;
  const up = route.dir === "up";
  const inTop = new Set(top.map((t) => t.node.id));
  const betweenIds = up
    ? r.filter((id, i) => id !== focusId && i !== r.length - 2 && !(i === 0 && inTop.has(id)))
    : r.slice(2);
  return {
    focus: nodeOf(focusId),
    top,
    topTotal: tops.length,
    through: via ? nodeOf(via) : null,
    direct: near("up"),
    renders: near("down"),
    route,
    between: betweenIds.map((id) => row(id, routes[route.dir].steps.get(id) as number, 0)),
    picked: {
      top: ends.top,
      direct: up && r.length >= 2 ? (r[r.length - 2] as string) : null,
      renders: !up && r.length >= 2 ? (r[1] as string) : null,
    },
    totals: { up: routes.up.steps.size - 1, down: routes.down.steps.size - 1 },
  };
}
