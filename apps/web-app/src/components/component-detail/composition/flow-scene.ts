import type { CompositionGraphNode } from "@scoutui/web-shared";
import {
  byCallSites,
  chipFaceFragments,
  edgeCounts,
  pathValueOf,
  routeIds,
  usesBetween,
  type BothRoutes,
  type Dir,
  type GraphModel,
  type Routes,
} from "./graph-model";

export type SceneState = {
  /** `dir:id` of components whose "+N more" is open as a list. */
  lists: ReadonlySet<string>;
  /** `dir:id` of components pulled out of a "+N more" into their column. */
  brought: ReadonlySet<string>;
  /** The selected component, if any. It shows what's one step further out. */
  pin: { dir: Dir; id: string } | null;
};

/** `dir:id`: a key in `SceneState`'s sets and the flow id of a box. */
export const dirId = (dir: Dir, id: string) => `${dir}:${id}`;
export const FOCUS = "focus";
/** Flow id of the "+N more" box, or of the list it opens into, hanging off
 *  the component `parentId`. A new id makes React Flow measure the list
 *  afresh. */
export const groupId = (kind: "more" | "list", dir: Dir, parentId: string) => `${kind}:${dir}:${parentId}`;
export const summaryId = (dir: Dir) => `summary:${dir}`;

export type Member = { node: CompositionGraphNode; uses: number };

type Box = { id: string; x: number; y: number; w: number; h: number };

export type ChipItem = Box & {
  kind: "chip";
  dir: Dir | null;
  node: CompositionGraphNode;
  steps: number;
  /** The box one step nearer the focus that this one hangs off. */
  innerId: string | null;
  /** Uses between this component and the one at `innerId`. */
  usesToInner: number;
  /** What tells this box apart from another box of the same name, shown after its name; never on the focus. */
  fragment: string | null;
};

export type GroupItem = Box & {
  kind: "more" | "list";
  dir: Dir;
  /** Flow id of the box the group hangs off. */
  parentId: string;
  /** Component id of that box. */
  parentRealId: string;
  steps: number;
  members: Member[];
  uses: number;
};

export type SummaryItem = Box & { kind: "summary"; dir: Dir; direct: number; total: number };

export type SceneItem = ChipItem | GroupItem | SummaryItem;

export type SceneEdge = {
  id: string;
  source: string;
  target: string;
  count: number;
  dir: Dir;
  group: boolean;
  /** The line in words, for screen readers. */
  label: string;
};

export type ColumnHeading = { text: string; x: number; y: number };

export type Scene = {
  /** In reading order: columns left to right, each top to bottom. */
  items: SceneItem[];
  edges: SceneEdge[];
  headings: ColumnHeading[];
  /** Flow ids along the selected route, the focus included. Empty when nothing is selected. */
  pathIds: Set<string>;
};

export const CHIP_H = 32;
/** Most an open list grows to before its rows scroll. */
export const LIST_H = 320;
/** An open list's heading (up to two lines), filter and footer. */
const LIST_CHROME_H = 112;
const LIST_ROW_H = 48;
export const SUMMARY_H = 52;
const GAP_Y = 10;
const BLOCK_GAP = 22;
export const GAP_X = 68;
const MIN_W = 128;
const MAX_W = 232;
const LIST_W = 272;
/** Direct neighbours of the focus shown before the rest fold into "+N more". */
export const FOCUS_CAP = 10;
/** Neighbours shown when a box further out is selected. */
export const OPEN_CAP = 5;
/** Height above a column's top box where its heading sits. */
export const HEADING_H = 26;

function chipWidth(name: string, fragment: string | null): number {
  // Mono 12px is about 7.2px per character; the glyph, padding and the
  // deprecated mark take the rest. A label adds its "· " and the gap before it.
  const chars = name.length + (fragment ? fragment.length + 2 : 0);
  return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(chars * 7.2) + (fragment ? 6 : 0) + 48));
}

type Placed = SceneItem & { parentFlowId: string | null };

type SideResult = {
  columns: Placed[][];
  /** Component id -> flow id and column, for components drawn on this side,
   *  as a box of their own or inside a group. */
  drawn: Map<string, { flowId: string; col: number; group?: boolean }>;
  edges: SceneEdge[];
  /** Components at each step, for headings. */
  totals: Map<number, number>;
};

function buildSide(
  model: GraphModel,
  focusId: string,
  dir: Dir,
  routes: Routes,
  counts: Map<string, number>,
  state: SceneState,
  pathSet: ReadonlySet<string>,
): SideResult {
  const next = dir === "up" ? model.parentsOf : model.childrenOf;
  const columns: Placed[][] = [[]];
  const drawn: SideResult["drawn"] = new Map([[focusId, { flowId: FOCUS, col: 0 }]]);
  const edges: SceneEdge[] = [];
  const totals = new Map<number, number>();
  for (const s of routes.steps.values()) if (s > 0) totals.set(s, (totals.get(s) ?? 0) + 1);

  // Boxes to open, column by column: the focus first, then the selected box
  // and the boxes its route passes through.
  let frontier: { id: string; flowId: string; col: number }[] = [{ id: focusId, flowId: FOCUS, col: 0 }];
  while (frontier.length > 0) {
    const nextFrontier: typeof frontier = [];
    for (const v of frontier) {
      // A route two or more steps long folds even the focus's own column
      // down to the step on the route.
      const fully = v.id === focusId ? !(pathSet.size > 2) : state.pin?.dir === dir && state.pin.id === v.id;
      const onRoute = pathSet.has(v.id);
      if (!fully && !onRoute) continue;
      const col = v.col + 1;
      const candidates: CompositionGraphNode[] = [];
      const seen = new Set<string>();
      for (const { id } of next.get(v.id) ?? []) {
        if (seen.has(id) || drawn.has(id) || id === focusId) continue;
        if (routes.steps.get(id) !== col) continue;
        const node = model.byId.get(id);
        if (!node) continue;
        seen.add(id);
        candidates.push(node);
      }
      if (candidates.length === 0) continue;
      candidates.sort(byCallSites((n) => usesBetween(counts, dir, v.id, n.id)));
      const cap = v.id === focusId ? FOCUS_CAP : OPEN_CAP;
      let shown: CompositionGraphNode[];
      let hidden: CompositionGraphNode[];
      if (fully) {
        const fold = candidates.length > cap + 1;
        shown = fold ? candidates.slice(0, cap) : candidates;
        hidden = fold ? candidates.slice(cap) : [];
      } else {
        shown = candidates.filter((n) => pathSet.has(n.id));
        hidden = candidates.filter((n) => !pathSet.has(n.id));
      }
      const rescued = hidden.filter((n) => pathSet.has(n.id) || state.brought.has(dirId(dir, n.id)));
      hidden = hidden.filter((n) => !rescued.includes(n));
      shown = [...shown, ...rescued];

      if (!columns[col]) columns[col] = [];
      const column = columns[col] as Placed[];
      for (const node of shown) {
        const id = dirId(dir, node.id);
        drawn.set(node.id, { flowId: id, col });
        column.push({
          kind: "chip",
          id,
          dir,
          node,
          steps: col,
          innerId: v.flowId,
          usesToInner: usesBetween(counts, dir, v.id, node.id),
          fragment: null,
          x: 0,
          y: 0,
          w: chipWidth(node.displayName, null),
          h: CHIP_H,
          parentFlowId: v.flowId,
        });
        nextFrontier.push({ id: node.id, flowId: id, col });
      }
      if (hidden.length > 0) {
        const members = hidden.map((node) => ({ node, uses: usesBetween(counts, dir, v.id, node.id) }));
        const uses = members.reduce((s, m) => s + m.uses, 0);
        const isList = state.lists.has(dirId(dir, v.id));
        const id = groupId(isList ? "list" : "more", dir, v.id);
        column.push({
          kind: isList ? "list" : "more",
          id,
          dir,
          parentId: v.flowId,
          parentRealId: v.id,
          steps: col,
          members,
          uses,
          x: 0,
          y: 0,
          w: isList ? LIST_W : MIN_W,
          h: isList ? Math.min(LIST_H, LIST_CHROME_H + members.length * LIST_ROW_H) : CHIP_H,
          parentFlowId: v.flowId,
        });
        for (const m of hidden) drawn.set(m.id, { flowId: id, col, group: true });
        edges.push(
          dir === "up"
            ? { id: `${id}>${v.flowId}`, source: id, target: v.flowId, count: uses, dir, group: true, label: "" }
            : { id: `${v.flowId}>${id}`, source: v.flowId, target: id, count: uses, dir, group: true, label: "" },
        );
      }
    }
    frontier = nextFrontier;
  }

  // Real render edges between boxes in adjacent columns on this side.
  for (const e of model.edges) {
    const outer = dir === "up" ? e.source : e.target;
    const inner = dir === "up" ? e.target : e.source;
    const o = drawn.get(outer);
    const i = drawn.get(inner);
    if (!o || !i || o.col !== i.col + 1) continue;
    if (o.group || i.group) continue;
    const [source, target] = dir === "up" ? [o.flowId, i.flowId] : [i.flowId, o.flowId];
    const id = `${source}>${target}`;
    if (edges.some((x) => x.id === id)) continue;
    edges.push({ id, source, target, count: e.count, dir, group: false, label: "" });
  }
  return { columns, drawn, edges, totals };
}

/** Left-to-right column of an item: negative for what renders the focus. */
function columnOf(item: SceneItem): number {
  if (item.kind === "summary") return item.dir === "up" ? -1 : 1;
  if (item.dir === null) return 0;
  return item.dir === "up" ? -item.steps : item.steps;
}

/**
 * Columns by steps on each side of the focus: what renders it to the left,
 * what it renders to the right. The focus's direct neighbours are always
 * shown; a selected box shows what's one step further out, and its route
 * opens just the boxes along it. When the route runs two or more steps out, the
 * other side shrinks to one summary box.
 */
export function buildScene(model: GraphModel, focusId: string, routes: BothRoutes, state: SceneState): Scene {
  const counts = edgeCounts(model);
  const pinRoute = state.pin ? routeIds(routes[state.pin.dir], focusId, state.pin.id) : [];
  const pathSetFor = (dir: Dir) => new Set(state.pin?.dir === dir ? pinRoute : []);
  const collapseOther = state.pin !== null && pinRoute.length > 2;

  const focusNode = model.byId.get(focusId) as CompositionGraphNode;
  const focusItem: Placed = {
    kind: "chip",
    id: FOCUS,
    dir: null,
    node: focusNode,
    steps: 0,
    innerId: null,
    usesToInner: 0,
    fragment: null,
    x: 0,
    y: -CHIP_H / 2,
    w: chipWidth(focusNode.displayName, null),
    h: CHIP_H,
    parentFlowId: null,
  };

  const items: SceneItem[] = [focusItem];
  const edges: SceneEdge[] = [];
  const headings: ColumnHeading[] = [];
  const pathIds = new Set<string>();

  const sides = new Map<Dir, SideResult>();
  for (const dir of ["up", "down"] as const) {
    if (!collapseOther || state.pin?.dir === dir) sides.set(dir, buildSide(model, focusId, dir, routes[dir], counts, state, pathSetFor(dir)));
  }
  // Labels are worked out over every box drawn, the focus included, but the focus never shows one.
  const chips = [focusItem, ...[...sides.values()].flatMap((side) => side.columns.flat())].filter((i): i is Placed & ChipItem => i.kind === "chip");
  const fragments = chipFaceFragments(chips.map((c) => ({ name: c.node.displayName, path: pathValueOf(c.node) })));
  chips.forEach((chip, i) => {
    if (chip.id === FOCUS) return;
    chip.fragment = fragments[i] ?? null;
    chip.w = chipWidth(chip.node.displayName, chip.fragment);
  });

  for (const dir of ["up", "down"] as const) {
    const side = sides.get(dir);
    if (!side) {
      let direct = 0;
      for (const s of routes[dir].steps.values()) if (s === 1) direct++;
      if (direct === 0) continue;
      const w = 200;
      items.push({
        kind: "summary",
        id: summaryId(dir),
        dir,
        direct,
        total: routes[dir].steps.size - 1,
        x: dir === "up" ? -GAP_X - w : focusItem.w + GAP_X,
        y: -SUMMARY_H / 2,
        w,
        h: SUMMARY_H,
      });
      continue;
    }
    edges.push(...side.edges);
    if (state.pin?.dir === dir) {
      for (const id of pinRoute) {
        const at = side.drawn.get(id);
        if (at) pathIds.add(at.flowId);
      }
    }

    // x: each column as wide as its widest item, laid out away from the focus.
    let edgeX = dir === "up" ? -GAP_X : focusItem.w + GAP_X;
    const yOf = new Map<string, number>([[FOCUS, 0]]);
    for (let col = 1; col < side.columns.length; col++) {
      const column = side.columns[col] ?? [];
      if (column.length === 0) break;
      // Boxes and "+N more" take the column's width; an open list keeps its
      // own and lines up with the column's inner edge. The next column starts
      // past the widest of them.
      const w = Math.max(...column.filter((c) => c.kind !== "list").map((c) => c.w), MIN_W);
      const span = Math.max(...column.map((c) => c.w), w);
      const left = dir === "up" ? edgeX - w : edgeX;
      for (const item of column) {
        if (item.kind !== "list") item.w = w;
        item.x = dir === "up" ? left + (w - item.w) : left;
      }

      // y: each parent's block centred on it, pushed down past the block
      // above. The direct column centres on the focus.
      const blocks: Placed[][] = [];
      for (const item of column) {
        const last = blocks[blocks.length - 1];
        if (last && last[0]?.parentFlowId === item.parentFlowId) last.push(item);
        else blocks.push([item]);
      }
      let floor = Number.NEGATIVE_INFINITY;
      for (const block of blocks) {
        const height = block.reduce((s, b) => s + b.h, 0) + GAP_Y * (block.length - 1);
        const centre = yOf.get(block[0]?.parentFlowId ?? FOCUS) ?? 0;
        let y = Math.max(centre - height / 2, floor);
        for (const item of block) {
          item.y = y;
          yOf.set(item.id, y + item.h / 2);
          y += item.h + GAP_Y;
        }
        floor = y - GAP_Y + BLOCK_GAP;
      }
      items.push(...column);

      const where = col === 1 ? "Directly" : `${col} steps away`;
      const top = Math.min(...column.map((c) => c.y));
      headings.push({
        text: `${where} · ${(side.totals.get(col) ?? 0).toLocaleString()}`,
        x: dir === "up" ? left + w : left,
        y: top - HEADING_H,
      });
      edgeX = dir === "up" ? edgeX - span - GAP_X : edgeX + span + GAP_X;
    }
  }
  if (pathIds.size > 0) pathIds.add(FOCUS);
  items.sort((a, b) => columnOf(a) - columnOf(b) || a.y - b.y);
  const byId = new Map(items.map((i) => [i.id, i]));
  const nameOf = (item: SceneItem | undefined) =>
    item?.kind === "chip"
      ? item.node.displayName
      : item?.kind === "more" || item?.kind === "list"
        ? `${item.members.length.toLocaleString()} more ${item.members.length === 1 ? "component" : "components"}`
        : "";
  for (const e of edges) {
    const source = byId.get(e.source);
    const target = nameOf(byId.get(e.target));
    e.label =
      source?.kind === "more" || source?.kind === "list"
        ? `${nameOf(source)} ${source.members.length === 1 ? "renders" : "render"} ${target}`
        : rendersSentence(nameOf(source), target, e.count);
  }
  return { items, edges, headings, pathIds };
}

/** How many times, in words: "once", "twice", "5 times". */
export function timesWord(n: number): string {
  if (n === 1) return "once";
  if (n === 2) return "twice";
  return `${n.toLocaleString()} times`;
}

const rendersSentence = (renderer: string, rendered: string, uses: number) =>
  `${renderer} renders ${rendered} ${timesWord(uses)}`;

/** The bar's last sentence when selecting a box opens nothing: nothing renders
 *  it (or it renders nothing), or everything that does is as near the focus
 *  as it is. Null when something is further out. */
export function nothingFurtherOut(model: GraphModel, routes: Routes, dir: Dir, id: string): string | null {
  const next = dir === "up" ? model.parentsOf : model.childrenOf;
  const ids = (next.get(id) ?? []).map((a) => a.id).filter((x) => x !== id);
  const steps = routes.steps.get(id) ?? 0;
  if (ids.some((x) => routes.steps.get(x) === steps + 1)) return null;
  const name = model.byId.get(id)?.displayName ?? id;
  if (ids.length === 0) return dir === "up" ? `Nothing in this repo renders ${name}.` : `${name} renders no other components.`;
  return dir === "up" ? `Nothing further out renders ${name}.` : `${name} renders nothing further out.`;
}

/** A route in words, a clause a step, in render order: "A renders B once,
 *  and B renders C 5 times." `uses[i]` is the uses from `chain[i]` to
 *  `chain[i + 1]`. */
export function routeSentence(chain: readonly string[], uses: readonly number[]): string {
  const clauses = uses.map((n, i) => rendersSentence(chain[i] ?? "", chain[i + 1] ?? "", n));
  if (clauses.length <= 1) return `${clauses.join("")}.`;
  return `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}.`;
}
