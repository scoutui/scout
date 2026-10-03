import { COLUMN_CAP, GAP_X, GAP_Y, MAX_NODE_W, NODE_H, NODE_W } from "./graph-layout";

export const READABLE_ZOOM = 1;
/** While a path is pinned the whole picture may fit a little smaller than the
 *  at-rest floor; framing the path alone would crop the column it runs into. */
export const PINNED_FIT_ZOOM = 0.8;
export const WINDOW_ZOOM = 1;
export const FRAME_PADDING = 24;
/** How far above a windowed column's top its heading label renders. */
export const COLUMN_LABEL_OFFSET_Y = 26;
/** Vertical room reserved above a windowed column for its heading label. Larger
 *  than COLUMN_LABEL_OFFSET_Y plus the label's line height, so the label is
 *  never clipped. */
export const LABEL_CLEARANCE = 56;
/** Horizontal room reserved on both edges of a windowed frame for the
 *  hidden-column pill (about 78px from the shell edge, measured).
 *  FRAME_PADDING + PILL_GUTTER = 88px, so the nearest included column starts
 *  clear of the pill. It doesn't stop a hidden neighbour's sliver showing
 *  under the pill; hiddenColumns() owns that threshold. */
export const PILL_GUTTER = 64;
/** fitView padding for both fit call sites. `top` clears the column headings,
 *  which render above the bounds ReactFlow computes from the nodes. */
export const FIT_PADDING = { top: "44px", right: "6%", bottom: "6%", left: "6%" } as const;

/** How much wider and taller than the scene's bounds the pane must be for the
 *  whole scene to count as fitting. */
const FIT_MARGIN = 1.16;

/** One row's height plus the gap to the next. */
const ROW_PITCH = NODE_H + GAP_Y;
/** Fewest rows a column folds down to, however short the pane. */
export const MIN_ROW_BUDGET = 3;

/**
 * How many rows a column may show before folding its overflow into the
 * "+N more" chip, given the pane's measured height. An overflowing row would
 * clip without warning.
 * computeLayout can render one row past the budget when the overflow is a
 * single item (it never shows "+1 more"), so this reserves that row:
 * `floor(rows) - 1`. Clamped to [MIN_ROW_BUDGET, COLUMN_CAP].
 */
export function computeRowBudget(paneHeight: number): number {
  const available = paneHeight - LABEL_CLEARANCE;
  const maxRows = Math.floor((available + GAP_Y) / ROW_PITCH);
  return Math.min(COLUMN_CAP, Math.max(MIN_ROW_BUDGET, maxRows - 1));
}

/**
 * Chip width for a pane of the given width: as wide as three columns (parents,
 * focus, children) can be while still fitting at full zoom, between NODE_W and
 * MAX_NODE_W. A pane too narrow for three NODE_W columns keeps NODE_W.
 */
export function computeChipWidth(paneWidth: number): number {
  const fitting = Math.floor((paneWidth / FIT_MARGIN - 2 * GAP_X) / 3);
  return Math.min(MAX_NODE_W, Math.max(NODE_W, fitting));
}

export type DefaultFrame =
  | { kind: "fit" }
  | {
      kind: "window";
      centerX: number;
      centerY: number;
      zoom: number;
      hiddenLeft: number;
      hiddenRight: number;
      /** Gutter-mask width for this side (see `bleed` in
       *  `computeDefaultFrame`). 0 when that side has no hidden column. */
      maskLeft: number;
      maskRight: number;
    };

export type ViewportTransform = { x: number; y: number; zoom: number };

/** The default (unpinned) viewport: fit while readable, else a window of whole
 *  columns around the focus column (x=0). A column is either in frame or
 *  counted in hiddenLeft/hiddenRight for the edge pills. Centring the included
 *  span puts a leaf's focus at the right edge and a root's at the left. */
export function computeDefaultFrame(
  items: ReadonlyArray<{ x: number; y: number }>,
  viewW: number,
  viewH: number,
  /** Smallest zoom at which the whole picture still counts as fitting. The
   *  at-rest floor by default; a pinned path passes PINNED_FIT_ZOOM. */
  minZoom: number = READABLE_ZOOM,
  chipWidth: number = NODE_W,
): DefaultFrame {
  if (viewW <= 0 || viewH <= 0 || items.length === 0) return { kind: "fit" };
  const xs = items.map((i) => i.x);
  const ys = items.map((i) => i.y);
  const bw = Math.max(...xs) + chipWidth - Math.min(...xs);
  const bh = Math.max(...ys) + NODE_H - Math.min(...ys);
  if (Math.min(viewW / (bw * FIT_MARGIN), viewH / (bh * FIT_MARGIN)) >= minZoom) return { kind: "fit" };

  const columns = [...new Set(xs)].sort((a, b) => a - b);
  const focusIdx = columns.indexOf(0);
  if (focusIdx === -1) return { kind: "fit" };

  const firstColumn = columns[0] as number;
  const lastColumn = columns[columns.length - 1] as number;
  const fullSpan = (lastColumn + chipWidth - firstColumn) * WINDOW_ZOOM;
  let lo: number;
  let hi: number;
  if (fullSpan <= viewW - FRAME_PADDING * 2) {
    // Every column fits on FRAME_PADDING alone, so no pill will render and
    // there is no PILL_GUTTER to reserve. Windowing a subset here would bleed
    // unlabelled fragments of the dropped column into the frame.
    lo = 0;
    hi = columns.length - 1;
  } else {
    // Both edges reserve room for a hidden-column pill (see PILL_GUTTER).
    const usable = viewW - (FRAME_PADDING + PILL_GUTTER) * 2;
    lo = focusIdx;
    hi = focusIdx;
    let extended = true;
    while (extended) {
      extended = false;
      if (hi + 1 < columns.length && ((columns[hi + 1] as number) + chipWidth - (columns[lo] as number)) * WINDOW_ZOOM <= usable) {
        hi += 1;
        extended = true;
      }
      if (lo - 1 >= 0 && ((columns[hi] as number) + chipWidth - (columns[lo - 1] as number)) * WINDOW_ZOOM <= usable) {
        lo -= 1;
        extended = true;
      }
    }
  }
  // The window is centred on the included span, so the margin to the nearest
  // included column is the same on both sides. The nearest hidden column
  // bleeds `margin - GAP_X * zoom` past the pane edge, which is less than the
  // margin, so a mask that wide can never reach an included column's heading.
  const windowSpan = ((columns[hi] as number) + chipWidth - (columns[lo] as number)) * WINDOW_ZOOM;
  const margin = (viewW - windowSpan) / 2;
  const bleed = Math.max(0, margin - GAP_X * WINDOW_ZOOM);
  // A column taller than the viewport, centred at y=0, would hide its heading
  // label, so the frame anchors to the top with LABEL_CLEARANCE of headroom.
  // Only the windowed columns count: a hidden column never sets the vertical
  // frame.
  const winYs = items
    .filter((i) => i.x >= (columns[lo] as number) && i.x <= (columns[hi] as number))
    .map((i) => i.y);
  const winMinY = Math.min(...winYs);
  const winBh = Math.max(...winYs) + NODE_H - winMinY;
  const centerY =
    (winBh + LABEL_CLEARANCE) * WINDOW_ZOOM > viewH ? winMinY - LABEL_CLEARANCE + viewH / (2 * WINDOW_ZOOM) : 0;
  return {
    kind: "window",
    centerX: ((columns[lo] as number) + (columns[hi] as number) + chipWidth) / 2,
    centerY,
    zoom: WINDOW_ZOOM,
    hiddenLeft: lo,
    hiddenRight: columns.length - 1 - hi,
    maskLeft: lo > 0 ? bleed : 0,
    maskRight: columns.length - 1 - hi > 0 ? bleed : 0,
  };
}

export function isNodeVisible(
  item: { x: number; y: number },
  vp: ViewportTransform,
  viewW: number,
  viewH: number,
  chipWidth: number = NODE_W,
): boolean {
  const left = item.x * vp.zoom + vp.x;
  const top = item.y * vp.zoom + vp.y;
  return left >= 0 && top >= 0 && left + chipWidth * vp.zoom <= viewW && top + NODE_H * vp.zoom <= viewH;
}

export function isPathVisible(
  items: ReadonlyArray<{ x: number; y: number }>,
  vp: ViewportTransform,
  viewW: number,
  viewH: number,
  chipWidth: number = NODE_W,
): boolean {
  return items.length > 0 && items.every((i) => isNodeVisible(i, vp, viewW, viewH, chipWidth));
}

/**
 * Whether an `onMoveEnd` should recompute the edge pills and gutter masks from
 * the live viewport. Not at the default frame, where `hiddenColumns` would
 * read a hidden column's bleed as visible and remove its pill, and not while
 * pinned, where the camera is narrowed to the path on purpose.
 */
export function shouldRecomputeEdgeAffordances(wasDefaultFrame: boolean, isPinned: boolean): boolean {
  return !isPinned && !wasDefaultFrame;
}

/** Hidden-column counts for the edge pills, from the current viewport. A
 *  column counts as visible when at least half a chip width (at the current
 *  zoom) is inside the viewport; otherwise it is hidden on the side its
 *  midpoint falls.
 *
 *  Not valid at the default frame: a hidden column can bleed past the
 *  half-chip threshold (measured 119px of a 176px chip) and read as visible.
 *  The frame's own hiddenLeft/hiddenRight are correct there, so call this only
 *  after a user pan or zoom (see `shouldRecomputeEdgeAffordances`). */
export function hiddenColumns(
  items: ReadonlyArray<{ x: number }>,
  vp: ViewportTransform,
  viewW: number,
  chipWidth: number = NODE_W,
): { left: number; right: number } {
  // jsdom, and any element not yet measured, reports clientWidth 0, which
  // would make every column read as hidden.
  if (viewW <= 0) return { left: 0, right: 0 };
  const columns = [...new Set(items.map((i) => i.x))].sort((a, b) => a - b);
  const threshold = (chipWidth * vp.zoom) / 2;
  let left = 0;
  let right = 0;
  for (const x of columns) {
    const l = x * vp.zoom + vp.x;
    const r = (x + chipWidth) * vp.zoom + vp.x;
    const visible = Math.min(r, viewW) - Math.max(l, 0);
    if (visible >= threshold) continue;
    if ((l + r) / 2 < viewW / 2) left += 1;
    else right += 1;
  }
  return { left, right };
}

/**
 * Width of the mask over a pane edge with hidden columns, at the live zoom.
 * A hidden column may still show up to `chipWidth * zoom / 2` past the edge
 * (hiddenColumns()'s threshold), which grows with zoom, so the mask grows with
 * it. `FRAME_PADDING + PILL_GUTTER` (88px) is the floor, which equals that
 * sliver for a NODE_W chip at zoom 1.
 */
export function gutterMaskWidth(zoom: number, chipWidth: number = NODE_W): number {
  return Math.max(FRAME_PADDING + PILL_GUTTER, (chipWidth * zoom) / 2);
}

export type EdgePillCopy = { label: string; ariaLabel: string; remedy: "showAll" | "resetView" };

/**
 * The edge pill's label, aria-label and remedy for one side. At the default
 * frame a reset would change nothing, so the remedy is show all (fitAll);
 * after a pan or zoom it is reset view. The visible label is the hidden count
 * either way, and the aria-label names the remedy.
 */
export function edgePillCopy(side: "left" | "right", count: number, atDefaultFrame: boolean): EdgePillCopy {
  const noun = count === 1 ? "column" : "columns";
  const sideText = side === "left" ? "to the left" : "to the right";
  const label = side === "left" ? `← ${count.toLocaleString()} more` : `${count.toLocaleString()} more →`;
  if (atDefaultFrame) {
    return {
      label,
      ariaLabel: `${count.toLocaleString()} more ${noun} off screen ${sideText}, show all`,
      remedy: "showAll",
    };
  }
  return {
    label,
    ariaLabel: `${count.toLocaleString()} more ${noun} off screen ${sideText}, reset view`,
    remedy: "resetView",
  };
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
 * Identical paths stay identical: they are the same file. The full value stays
 * in the row's `aria-label`. Rail rows, chip tooltips and member-panel rows
 * all call this.
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
 * Disambiguating path fragment for each chip in one scene, or `null` when the
 * chip's name is already unique, its path is empty, or every chip sharing its
 * name has the same path. Chips sharing a display name (two `ServerPage`s on
 * one canvas) each get the shortest fragment that tells them apart, from
 * `distinctTails` over that group. The fragment drops the leading `…/` and,
 * when every tail ends in the same file name, that file name too: so
 * `…/[type]/page.tsx` and `…/[id]/page.tsx` become `[type]` and `[id]`.
 * Returns the fragment alone; `ChipNode` renders it in its own span.
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
