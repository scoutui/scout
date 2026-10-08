import type { CompositionGraphNode } from "@scoutui/web-shared";
import {
  byCallSites,
  chipFaceFragments,
  edgeCounts,
  pathValueOf,
  usesBetween,
  type BothRoutes,
  type Dir,
  type GraphModel,
} from "./graph-model";

export type SceneState = {
  /** `dir:id` of components whose "+N more" is open as a list. */
  lists: ReadonlySet<string>;
  /** `dir:id` of components pulled out of a "+N more" into their column. */
  brought: ReadonlySet<string>;
  /** The opened route, if any: component ids read outward from the focus,
   *  the selected box last. Each step is real (see `realRoute`). The selected
   *  box shows everything one step further out. */
  pin: { dir: Dir; ids: string[] } | null;
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
  /** Component ids from the focus's neighbour out to this box: the route that selecting it opens. */
  route: string[];
  /** The component also appears nearer the focus, as a box or in a "+N more". */
  repeat: boolean;
  /** The component is already on the route, or is the focus: it closes a loop and can't be opened. */
  loop: boolean;
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
  /** The route of that box; empty for the focus. */
  parentRoute: string[];
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
  /** "×3" on a line along the selected route whose component renders the next more than once. */
  weight: string | null;
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
const MAX_W = 400;
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
  edges: SceneEdge[];
  /** Components a column holds, for columns that fold some into "+N more"
   *  and aren't folded down to the route. */
  held: Map<number, number>;
};

/** The flow id of the box at the end of `route`. */
export const routeId = (dir: Dir, route: readonly string[]) => dirId(dir, route.join(","));

function buildSide(
  model: GraphModel,
  focusId: string,
  dir: Dir,
  route: readonly string[],
  counts: Map<string, number>,
  state: SceneState,
): SideResult {
  const next = dir === "up" ? model.parentsOf : model.childrenOf;
  const columns: Placed[][] = [[]];
  const edges: SceneEdge[] = [];
  const held = new Map<number, number>();
  const nearest = new Map<string, number>();

  // The focus opens first, then each box on the route in turn. Every box but
  // the last folds its column down to the next step; the last, and the focus
  // when the route is at most one step, show what they open in full.
  let parent = { id: focusId, flowId: FOCUS, route: [] as string[] };
  for (let col = 1; col <= route.length + 1; col++) {
    const step = route[col - 1];
    const fully = step === undefined || (col === 1 && route.length === 1);
    const passed = new Set([focusId, ...parent.route]);
    const candidates: CompositionGraphNode[] = [];
    for (const { id } of next.get(parent.id) ?? []) {
      const node = model.byId.get(id);
      if (!node || passed.has(id) || candidates.includes(node)) continue;
      candidates.push(node);
    }
    const loops: CompositionGraphNode[] = [];
    if (step === undefined && col > 1) {
      for (const { id } of next.get(parent.id) ?? []) {
        const node = model.byId.get(id);
        if (node && id !== parent.id && passed.has(id) && !loops.includes(node)) loops.push(node);
      }
    }
    if (candidates.length + loops.length === 0) break;
    const order = byCallSites((n) => usesBetween(counts, dir, parent.id, n.id));
    candidates.sort(order);
    loops.sort(order);
    for (const n of candidates) if (!nearest.has(n.id)) nearest.set(n.id, col);

    const cap = col === 1 ? FOCUS_CAP : OPEN_CAP;
    let shown: CompositionGraphNode[];
    let hidden: CompositionGraphNode[];
    if (fully) {
      const fold = candidates.length > cap + 1;
      shown = fold ? candidates.slice(0, cap) : candidates;
      hidden = fold ? candidates.slice(cap) : [];
    } else {
      shown = candidates.filter((n) => n.id === step);
      hidden = candidates.filter((n) => n.id !== step);
    }
    const rescued = hidden.filter((n) => n.id === step || state.brought.has(dirId(dir, n.id)));
    hidden = hidden.filter((n) => !rescued.includes(n));
    shown = [...shown, ...rescued];
    if (fully && hidden.length > 0) held.set(col, candidates.length + loops.length);

    const column: Placed[] = [];
    columns[col] = column;
    for (const node of [...shown, ...loops]) {
      const nodeRoute = [...parent.route, node.id];
      column.push({
        kind: "chip",
        id: routeId(dir, nodeRoute),
        dir,
        node,
        steps: col,
        innerId: parent.flowId,
        route: nodeRoute,
        repeat: false,
        loop: loops.includes(node),
        usesToInner: usesBetween(counts, dir, parent.id, node.id),
        fragment: null,
        x: 0,
        y: 0,
        w: chipWidth(node.displayName, null),
        h: CHIP_H,
        parentFlowId: parent.flowId,
      });
    }
    if (hidden.length > 0) {
      const members = hidden.map((node) => ({ node, uses: usesBetween(counts, dir, parent.id, node.id) }));
      const uses = members.reduce((sum, m) => sum + m.uses, 0);
      const isList = state.lists.has(dirId(dir, parent.id));
      const id = groupId(isList ? "list" : "more", dir, parent.id);
      column.push({
        kind: isList ? "list" : "more",
        id,
        dir,
        parentId: parent.flowId,
        parentRealId: parent.id,
        parentRoute: parent.route,
        steps: col,
        members,
        uses,
        x: 0,
        y: 0,
        w: isList ? LIST_W : MIN_W,
        h: isList ? Math.min(LIST_H, LIST_CHROME_H + members.length * LIST_ROW_H) : CHIP_H,
        parentFlowId: parent.flowId,
      });
      edges.push(
        dir === "up"
          ? { id: `${id}>${parent.flowId}`, source: id, target: parent.flowId, count: uses, dir, group: true, label: "", weight: null }
          : { id: `${parent.flowId}>${id}`, source: parent.flowId, target: id, count: uses, dir, group: true, label: "", weight: null },
      );
    }
    if (step === undefined) break;
    parent = { id: step, flowId: routeId(dir, [...parent.route, step]), route: [...parent.route, step] };
  }

  // Real render edges between boxes in adjacent columns on this side.
  const chipsIn = (col: number) =>
    col === 0
      ? [{ id: FOCUS, nodeId: focusId }]
      : (columns[col] ?? []).flatMap((c) => (c.kind === "chip" ? [{ id: c.id, nodeId: c.node.id }] : []));
  for (let col = 1; col < columns.length; col++) {
    for (const o of chipsIn(col)) {
      for (const i of chipsIn(col - 1)) {
        const count = dir === "up" ? counts.get(`${o.nodeId}>${i.nodeId}`) : counts.get(`${i.nodeId}>${o.nodeId}`);
        if (count === undefined) continue;
        const [source, target] = dir === "up" ? [o.id, i.id] : [i.id, o.id];
        edges.push({ id: `${source}>${target}`, source, target, count, dir, group: false, label: "", weight: null });
      }
    }
  }
  for (const column of columns) {
    for (const item of column ?? []) if (item.kind === "chip") item.repeat = (nearest.get(item.node.id) ?? item.steps) < item.steps;
  }
  return { columns, edges, held };
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
 * shown; the selected box shows everything one step further out, components
 * already drawn nearer included, and the route to it opens just the boxes
 * along it. When the route runs two or more steps out, the other side shrinks
 * to one summary box.
 */
export function buildScene(model: GraphModel, focusId: string, routes: BothRoutes, state: SceneState): Scene {
  const counts = edgeCounts(model);
  const pin = state.pin;
  const collapseOther = pin !== null && pin.ids.length > 1;

  const focusNode = model.byId.get(focusId) as CompositionGraphNode;
  const focusItem: Placed = {
    kind: "chip",
    id: FOCUS,
    dir: null,
    node: focusNode,
    steps: 0,
    innerId: null,
    route: [],
    repeat: false,
    loop: false,
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
    if (!collapseOther || pin?.dir === dir) sides.set(dir, buildSide(model, focusId, dir, pin?.dir === dir ? pin.ids : [], counts, state));
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
    if (pin?.dir === dir) pin.ids.forEach((_, i) => pathIds.add(routeId(dir, pin.ids.slice(0, i + 1))));

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
      const held = side.held.get(col);
      const top = Math.min(...column.map((c) => c.y));
      headings.push({
        text: held === undefined ? where : `${where} · ${held.toLocaleString()}`,
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
    if (!e.group && e.count > 1 && pathIds.has(e.source) && pathIds.has(e.target)) e.weight = `×${e.count.toLocaleString()}`;
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
