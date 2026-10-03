import type { CompositionGraphNode } from "@scoutui/web-shared";
import { byCallSites, type GraphModel } from "./graph-model";

/** The narrowest a chip gets. The canvas widens chips up to MAX_NODE_W when
 *  the pane has room (see computeChipWidth). */
export const NODE_W = 176;
export const MAX_NODE_W = 240;
export const NODE_H = 28;
export const GAP_X = 72;
export const GAP_Y = 10;
/** Max rendered items per column. Overflow folds into one "+N more" chip that
 *  keeps the hidden members' edges. */
export const COLUMN_CAP = 10;

/** A node pinned into view because a panel row is tracing its path. */
export type PinnedEntry = { id: string; level: number };

export type LayoutState = { pinned: PinnedEntry[] | null };

export type LayoutItem =
  | { kind: "chip"; id: string; x: number; y: number; node: CompositionGraphNode; isFocus: boolean }
  | {
      kind: "more";
      id: string;
      x: number;
      y: number;
      level: number;
      nodes: CompositionGraphNode[];
      label: string;
    };

export type LayoutEdge = {
  id: string;
  source: string;
  target: string;
  /** Call sites, summed over the real render edges this drawn pair aggregates. */
  count: number;
  width: number;
};

export type CanvasLayout = {
  items: LayoutItem[];
  edges: LayoutEdge[];
  /** Real node id -> the display id it renders under. Drawn nodes only. */
  displayIdOf: Map<string, string>;
  /** Width of every chip in this layout. */
  chipWidth: number;
};

export function edgeWidth(count: number): number {
  if (count >= 50) return 3;
  if (count >= 20) return 2;
  if (count >= 5) return 1.5;
  return 1;
}

/** Places one item's slot, advancing `y` by one slot. */
function place(x: number, y: number, item: LayoutItem): number {
  item.x = x;
  item.y = y;
  return y + NODE_H + GAP_Y;
}

function chipItem(node: CompositionGraphNode, focusId: string): LayoutItem {
  return { kind: "chip", id: node.id, x: 0, y: 0, node, isFocus: node.id === focusId };
}

/**
 * The focus's direct neighbourhood: parents at -1, the focus at 0, children at
 * +1, each side sorted by call sites against the focus and folded into chips
 * plus one "+N more" chip. A pinned path (focus to endpoint, in path order)
 * keeps its ±1 step in its column and reveals each deeper step one column
 * further out. Edges are drawn only between adjacent columns, so the at-rest
 * picture is a star.
 */
export function computeLayout(
  model: GraphModel,
  focusId: string,
  state: LayoutState,
  /** Max rows a column shows before folding overflow into "+N more" (one more
   *  when the overflow is a single item). The canvas passes computeRowBudget's
   *  value for the pane height. */
  rowBudget: number = COLUMN_CAP,
  /** Width of every chip. The canvas passes computeChipWidth's value for the
   *  pane width. */
  chipWidth: number = NODE_W,
): CanvasLayout {
  const pinned = state.pinned ?? [];
  const pinnedIds = new Set(pinned.map((p) => p.id));

  // Direct neighbours. A self-render edge (F → F) never draws the focus as its
  // own neighbour.
  const parentNodes: CompositionGraphNode[] = [];
  const parentWeight = new Map<string, number>();
  for (const { id, count } of model.parentsOf.get(focusId) ?? []) {
    if (id === focusId || parentWeight.has(id)) continue;
    const node = model.byId.get(id);
    if (!node) continue;
    parentWeight.set(id, count);
    parentNodes.push(node);
  }

  // Pinned path, upward: it arrives focus → endpoint with levels 0, -1, -2, …
  // Step -1 is a direct parent and keeps its column (placeColumn rescues a
  // pinned node from the hidden tail). Each deeper step is revealed one column
  // further out than the one before.
  const revealedUp: { node: CompositionGraphNode; level: number }[] = [];
  {
    let prev = 0;
    for (const p of pinned) {
      if (p.level >= 0 || p.id === focusId) continue;
      if (parentWeight.has(p.id)) {
        prev = -1;
        continue;
      }
      const node = model.byId.get(p.id);
      if (!node) continue;
      prev -= 1;
      revealedUp.push({ node, level: prev });
    }
  }

  // Everything the owner side draws. A node reachable both ways (F ⇄ X) keeps
  // its owner slot and is excluded from the rendered side, so ReactFlow never
  // sees a duplicate id.
  const ownerDrawnIds = new Set<string>([
    focusId,
    ...parentWeight.keys(),
    ...revealedUp.map((r) => r.node.id),
  ]);

  const childNodes: CompositionGraphNode[] = [];
  const childWeight = new Map<string, number>();
  for (const { id, count } of model.childrenOf.get(focusId) ?? []) {
    if (ownerDrawnIds.has(id) || childWeight.has(id)) continue;
    const node = model.byId.get(id);
    if (!node) continue;
    childWeight.set(id, count);
    childNodes.push(node);
  }

  // Pinned path, downward: the mirror of the upward walk.
  const revealedDown: { node: CompositionGraphNode; level: number }[] = [];
  {
    let prev = 0;
    for (const p of pinned) {
      if (p.level <= 0 || p.id === focusId) continue;
      if (childWeight.has(p.id)) {
        prev = 1;
        continue;
      }
      if (ownerDrawnIds.has(p.id)) continue;
      const node = model.byId.get(p.id);
      if (!node) continue;
      prev += 1;
      revealedDown.push({ node, level: prev });
    }
  }

  // Items, displayIdOf and the level of every display id (chips and "more" chips).
  const displayIdOf = new Map<string, string>();
  const items: LayoutItem[] = [];
  const levelOfDisplay = new Map<string, number>();
  /** Display ids of overflow chips. Tracked as they're created, not read from
   *  the id prefix, so a component whose id starts with "more:" isn't mistaken
   *  for one. */
  const moreIds = new Set<string>();

  /** One column: the heaviest nodes up to the row budget, the rest folded into
   *  one "+N more" chip that carries their edges. A pinned node in the hidden
   *  tail is moved into `visible` at the end, never ahead of heavier nodes. */
  const placeColumn = (
    nodes: CompositionGraphNode[],
    level: number,
    weightOf: (n: CompositionGraphNode) => number,
  ): void => {
    const sorted = [...nodes].sort(byCallSites(weightOf));

    let visible = sorted;
    const hiddenMembers: CompositionGraphNode[] = [];
    // "+1 more" costs a row to save a row, so only fold when the overflow is
    // worth its own chip.
    if (sorted.length > rowBudget + 1) {
      visible = sorted.slice(0, rowBudget);
      for (const n of sorted.slice(rowBudget)) {
        if (pinnedIds.has(n.id)) visible.push(n);
        else hiddenMembers.push(n);
      }
    }

    for (const n of visible) {
      items.push(chipItem(n, focusId));
      displayIdOf.set(n.id, n.id);
      levelOfDisplay.set(n.id, level);
    }
    if (hiddenMembers.length > 0) {
      const moreId = `more:${level}`;
      items.push({
        kind: "more",
        id: moreId,
        x: 0,
        y: 0,
        level,
        nodes: hiddenMembers,
        label: `+${hiddenMembers.length.toLocaleString()} more ${hiddenMembers.length === 1 ? "component" : "components"}`,
      });
      levelOfDisplay.set(moreId, level);
      moreIds.add(moreId);
      for (const n of hiddenMembers) displayIdOf.set(n.id, moreId);
    }
  };

  const focusNode = model.byId.get(focusId);
  if (focusNode) {
    items.push(chipItem(focusNode, focusId));
    displayIdOf.set(focusId, focusId);
    levelOfDisplay.set(focusId, 0);
  }

  placeColumn(parentNodes, -1, (n) => parentWeight.get(n.id) ?? 0);
  placeColumn(childNodes, 1, (n) => childWeight.get(n.id) ?? 0);

  for (const r of [...revealedUp, ...revealedDown]) {
    items.push(chipItem(r.node, focusId));
    displayIdOf.set(r.node.id, r.node.id);
    levelOfDisplay.set(r.node.id, r.level);
  }

  // Geometry: group by level, centre slots around y=0, x by level.
  const itemsByLevel = new Map<number, LayoutItem[]>();
  for (const item of items) {
    const level = levelOfDisplay.get(item.id) ?? 0;
    const bucket = itemsByLevel.get(level);
    if (bucket) bucket.push(item);
    else itemsByLevel.set(level, [item]);
  }
  for (const [level, levelItems] of itemsByLevel) {
    const slotCount = levelItems.length;
    const columnH = slotCount * NODE_H + (slotCount - 1) * GAP_Y;
    const x = level * (chipWidth + GAP_X);
    let y = -columnH / 2;
    for (const item of levelItems) {
      y = place(x, y, item);
    }
  }
  // A revealed chip takes the y of the path step before it. Centred, it would
  // sit on the middle row while the ±1 step it feeds (often rescued to the
  // bottom of a full column) sits far below, and the path would draw as a long
  // S-bend. Carrying y along the path in order makes the revealed run a
  // straight line. Steps that aren't revealed chips keep their placed y.
  const revealedIds = new Set([...revealedUp, ...revealedDown].map((r) => r.node.id));
  if (revealedIds.size > 0) {
    const itemById = new Map(items.map((i) => [i.id, i] as const));
    const alignedLevels = new Set<number>();
    let prevY = itemById.get(focusId)?.y ?? 0;
    for (const p of pinned) {
      if (p.id === focusId) continue;
      const item = itemById.get(displayIdOf.get(p.id) ?? "");
      if (!item) continue;
      const level = levelOfDisplay.get(item.id);
      // One pinned path can't reveal two chips on one level; if that ever
      // changes, the second keeps its centred slot instead of stacking onto
      // the first.
      if (revealedIds.has(item.id) && level !== undefined && !alignedLevels.has(level)) {
        alignedLevels.add(level);
        item.y = prevY;
      }
      prevY = item.y;
    }
  }
  items.sort((a, b) => a.x - b.x || a.y - b.y);

  // Edges: render edges between drawn elements, summed per drawn pair (an edge
  // from a hidden member lands on its "+N more" chip), and only between
  // adjacent columns. A "+N more" chip draws only its edge to the focus; an
  // edge from a revealed chip into it would read as the chip looping back into
  // its own column.
  const agg = new Map<string, { source: string; target: string; count: number }>();
  for (const e of model.edges) {
    const source = displayIdOf.get(e.source);
    const target = displayIdOf.get(e.target);
    if (source === undefined || target === undefined || source === target) continue;
    if ((moreIds.has(source) && target !== focusId) || (moreIds.has(target) && source !== focusId)) continue;
    const ls = levelOfDisplay.get(source);
    const lt = levelOfDisplay.get(target);
    if (ls === undefined || lt === undefined || Math.abs(ls - lt) !== 1) continue;
    const key = `${source}>${target}`;
    const existing = agg.get(key);
    if (existing) existing.count += e.count;
    else agg.set(key, { source, target, count: e.count });
  }
  const edges: LayoutEdge[] = [...agg.values()].map(({ source, target, count }) => ({
    id: `${source}>${target}`,
    source,
    target,
    count,
    width: edgeWidth(count),
  }));

  return { items, edges, displayIdOf, chipWidth };
}
