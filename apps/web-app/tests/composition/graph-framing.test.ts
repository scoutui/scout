import { describe, it, expect } from "vitest";
import { COLUMN_CAP, GAP_X, GAP_Y, MAX_NODE_W, NODE_H, NODE_W } from "@/components/component-detail/composition/graph-layout";
import {
  computeChipWidth, computeDefaultFrame, computeRowBudget, edgePillCopy, gutterMaskWidth, isNodeVisible, isPathVisible, hiddenColumns,
  distinctTails, chipFaceFragments, shouldRecomputeEdgeAffordances,
  FRAME_PADDING, LABEL_CLEARANCE, MIN_ROW_BUDGET, PILL_GUTTER, PINNED_FIT_ZOOM, READABLE_ZOOM, WINDOW_ZOOM,
} from "@/components/component-detail/composition/graph-framing";

const COL = NODE_W + GAP_X;
/** items for columns at the given level indices, one item per column suffices */
const cols = (...levels: number[]) => levels.map((l) => ({ x: l * COL, y: 0 }));
/** Horizontal room the windowed frame reserves on both edges combined (frame
 *  padding plus the pill gutter). The viewport widths below are built from it,
 *  so they track FRAME_PADDING and PILL_GUTTER. */
const RESERVED = 2 * (FRAME_PADDING + PILL_GUTTER);

describe("computeDefaultFrame", () => {
  it("fits when the graph is readable at zoom 1", () => {
    expect(computeDefaultFrame(cols(-1, 0), 1000, 500)).toEqual({ kind: "fit" });
  });

  // A pin can add one row to a column (a ±1 node rescued from the hidden tail)
  // and tip a scene that fitted at rest just under the at-rest floor. The whole
  // picture is still readable there, so a pinned fit measures against
  // PINNED_FIT_ZOOM instead.
  it("a scene just under the at-rest floor is 'window' by default and 'fit' at the pinned floor", () => {
    // 4 columns (−2…+1) → bw = 3 * COL + NODE_W = 920; 12 rows → bh = 446.
    const rows = 12;
    const items = [-2, -1, 0, 1].flatMap((level) =>
      Array.from({ length: rows }, (_, r) => ({ x: level * COL, y: r * (NODE_H + GAP_Y) })),
    );
    const bw = 3 * COL + NODE_W;
    const bh = rows * NODE_H + (rows - 1) * GAP_Y;
    expect([bw, bh]).toEqual([920, 446]);
    const [viewW, viewH] = [1054, 486];
    // The scene sits between the two floors: too small for the at-rest one,
    // comfortably above the pinned one.
    const fitZoom = Math.min(viewW / (bw * 1.16), viewH / (bh * 1.16));
    expect(fitZoom).toBeLessThan(1);
    expect(fitZoom).toBeGreaterThan(PINNED_FIT_ZOOM);

    expect(computeDefaultFrame(items, viewW, viewH).kind).toBe("window");
    expect(computeDefaultFrame(items, viewW, viewH, PINNED_FIT_ZOOM)).toEqual({ kind: "fit" });
  });

  it("falls back to fit for a zero-size viewport (jsdom guard)", () => {
    expect(computeDefaultFrame(cols(-4, -3, -2, -1, 0), 0, 0)).toEqual({ kind: "fit" });
  });

  it("windows whole columns and reports hidden counts", () => {
    // 5 owner columns + focus; a viewport that fits ~3 columns at WINDOW_ZOOM
    const viewW = Math.ceil((2 * COL + NODE_W) * WINDOW_ZOOM) + RESERVED + 12; // 3 whole columns + padding
    const frame = computeDefaultFrame(cols(-5, -4, -3, -2, -1, 0), viewW, 200);
    expect(frame.kind).toBe("window");
    if (frame.kind !== "window") return;
    expect(frame.zoom).toBe(WINDOW_ZOOM);
    expect(frame.hiddenRight).toBe(0);          // nothing right of focus
    expect(frame.hiddenLeft).toBe(3);           // 3 of 5 owner columns excluded
    // included span = columns -2..0 → centered on their midpoint (leaf hugs right)
    expect(frame.centerX).toBe((-2 * COL + 0 + NODE_W) / 2);
    expect(frame.centerY).toBe(0);              // short column (y:0 only) stays centered
    // maskLeft covers the excluded neighbour's bleed (the margin minus GAP_X),
    // not the whole margin, so it stops short of the included column it borders.
    const windowWidth = (2 * COL + NODE_W) * WINDOW_ZOOM;
    const margin = (viewW - windowWidth) / 2;
    expect(frame.maskLeft).toBe(margin - GAP_X * WINDOW_ZOOM);
    expect(frame.maskRight).toBe(0);            // nothing hidden right → no mask needed there
  });

  it("reserves PILL_GUTTER beyond FRAME_PADDING on both sides, so the nearest included column starts clear of a hidden-column pill", () => {
    const viewW = Math.ceil((2 * COL + NODE_W) * WINDOW_ZOOM) + RESERVED + 12;
    const frame = computeDefaultFrame(cols(-5, -4, -3, -2, -1, 0), viewW, 200);
    if (frame.kind !== "window") throw new Error("expected window");
    const windowWidth = (2 * COL + NODE_W) * WINDOW_ZOOM; // columns -2..0
    const margin = (viewW - windowWidth) / 2;
    expect(margin).toBeGreaterThanOrEqual(FRAME_PADDING + PILL_GUTTER);
  });

  it("never includes a partial column: shrinking the viewport drops a whole column", () => {
    const wide = Math.ceil((2 * COL + NODE_W) * WINDOW_ZOOM) + RESERVED + 12;
    const narrow = wide - Math.ceil(COL * WINDOW_ZOOM); // one column less of room
    const frame = computeDefaultFrame(cols(-5, -4, -3, -2, -1, 0), narrow, 200);
    if (frame.kind !== "window") throw new Error("expected window");
    expect(frame.hiddenLeft).toBe(4);
    expect(frame.centerY).toBe(0);
  });

  it("a root (no owner columns) anchors from the focus outward to the right", () => {
    const viewW = Math.ceil((2 * COL + NODE_W) * WINDOW_ZOOM) + RESERVED + 12;
    const frame = computeDefaultFrame(cols(0, 1, 2, 3, 4, 5), viewW, 200);
    if (frame.kind !== "window") throw new Error("expected window");
    expect(frame.hiddenLeft).toBe(0);
    expect(frame.hiddenRight).toBe(3);
    expect(frame.centerX).toBe((0 + 2 * COL + NODE_W) / 2);
    expect(frame.centerY).toBe(0);
    const windowWidth = (2 * COL + NODE_W) * WINDOW_ZOOM;
    const margin = (viewW - windowWidth) / 2;
    expect(frame.maskLeft).toBe(0);              // nothing hidden left → no mask needed there
    expect(frame.maskRight).toBe(margin - GAP_X * WINDOW_ZOOM);
  });

  it("a contested last slot goes to the right (renders) side as the tie-break", () => {
    // Focus in the middle: 3 owner columns left, 1 right; only one more fits
    const viewW = Math.ceil((COL + NODE_W) * WINDOW_ZOOM) + RESERVED + 1;
    const frame = computeDefaultFrame(cols(-3, -2, -1, 0, 1), viewW, 200);
    expect(frame.kind).toBe("window");
    if (frame.kind !== "window") return;
    expect(frame.zoom).toBe(WINDOW_ZOOM);
    expect(frame.hiddenRight).toBe(0);           // right side wins (no hidden right)
    expect(frame.hiddenLeft).toBe(3);            // 3 of 3 left columns excluded
    // included span = columns 0..1 (focus + one right) centered on their midpoint
    expect(frame.centerX).toBe((0 + COL + NODE_W) / 2);
    expect(frame.centerY).toBe(0);
    const windowWidth = (COL + NODE_W) * WINDOW_ZOOM;
    const margin = (viewW - windowWidth) / 2;
    expect(frame.maskLeft).toBe(margin - GAP_X * WINDOW_ZOOM);
    expect(frame.maskRight).toBe(0);
  });

  it("anchors a tall column's window frame at its labeled top", () => {
    // One column (x=0), but its content (minY=0..maxY=500) is far taller than
    // viewH=200: the label band above minY can never fit if centerY stays 0.
    const items = [
      { x: 0, y: 0 },
      { x: 0, y: 200 },
      { x: 0, y: 500 },
    ];
    const frame = computeDefaultFrame(items, 1000, 200);
    expect(frame.kind).toBe("window");
    if (frame.kind !== "window") return;
    // bh = 500 + NODE_H(28) - 0 = 528; (528 + 56) > viewH(200) → top-anchor.
    // centerY = minY(0) - 56 + viewH(200) / (2 * WINDOW_ZOOM(1)) = 44.
    expect(frame.centerY).toBe(44);
  });

  it("keeps a short column vertically centered even when windowed horizontally", () => {
    // 5 owner columns + focus, all at y:0 → bh = NODE_H(28), far under viewH:
    // horizontal windowing alone must not force a top-anchor.
    const viewW = Math.ceil((2 * COL + NODE_W) * WINDOW_ZOOM) + RESERVED + 12;
    const frame = computeDefaultFrame(cols(-5, -4, -3, -2, -1, 0), viewW, 200);
    expect(frame.kind).toBe("window");
    if (frame.kind !== "window") return;
    expect(frame.centerY).toBe(0);
  });

  it("ignores a hidden tall column when the visible window is short", () => {
    // A 10-row entry column at x=-2*COL (columnH 370, y in [-185,157], 38px
    // pitch) sits outside the window; the window includes only columns -1..0,
    // each a single short chip at y=-14.
    const tallHiddenColumn = Array.from({ length: 10 }, (_, i) => ({ x: -2 * COL, y: -185 + i * 38 }));
    const items = [...tallHiddenColumn, { x: -COL, y: -14 }, { x: 0, y: -14 }];
    // Sized to include exactly columns -1..0 (hiddenLeft=1): usable =
    // COL + NODE_W lets the -1 column in; usable < COL*2 + NODE_W keeps -2 out.
    const viewW = Math.ceil((COL + NODE_W) * WINDOW_ZOOM) + RESERVED;
    const frame = computeDefaultFrame(items, viewW, 200);
    expect(frame.kind).toBe("window");
    if (frame.kind !== "window") return;
    expect(frame.hiddenLeft).toBe(1);
    // Windowed content is columns -1..0 only: y=-14 both → winBh = NODE_H(28).
    // (28 + 56) <= viewH(200) → centered, not a top-anchor derived from the
    // hidden column's minY=-185 (which would wrongly push the focus node,
    // y in [-14,14], out of frame).
    expect(frame.centerY).toBe(0);
  });

  it("top-anchors on the included tall column's minY, ignoring a more extreme hidden one", () => {
    // Focus column (x=0) is the tall one (10 rows, y in [-185,157]) and is
    // always inside the window. A hidden column further out (x=-2*COL) has a
    // single item at an even more extreme y=-500, which would leak in if the
    // calculation read the global extent.
    const tallVisibleColumn = Array.from({ length: 10 }, (_, i) => ({ x: 0, y: -185 + i * 38 }));
    const items = [{ x: -2 * COL, y: -500 }, ...tallVisibleColumn];
    // Small enough that only the focus column (x=0) fits: the hidden column is
    // 2 columns away, well past a single-column budget.
    const viewW = 448;
    const frame = computeDefaultFrame(items, viewW, 200);
    expect(frame.kind).toBe("window");
    if (frame.kind !== "window") return;
    expect(frame.hiddenLeft).toBe(1);
    // Windowed content is the tall column alone: winMinY=-185, winBh=370.
    // (370 + 56) > viewH(200) → top-anchor at winMinY(-185) - 56 + 200/2 = -141,
    // not the hidden column's y=-500 (which would give -456).
    expect(frame.centerY).toBe(-141);
  });

  describe("admit-when-fits", () => {
    it("admits the full column set once it fits FRAME_PADDING alone, even though PILL_GUTTER would have excluded a column (4 owner columns spanning 920px in a 982px pane)", () => {
      const viewW = 982;
      const frame = computeDefaultFrame(cols(-3, -2, -1, 0), viewW, 200);
      expect(frame.kind).toBe("window");
      if (frame.kind !== "window") return;
      expect(frame.hiddenLeft).toBe(0);
      expect(frame.hiddenRight).toBe(0);
      expect(frame.zoom).toBe(WINDOW_ZOOM);
      expect(frame.centerX).toBe((-3 * COL + 0 + NODE_W) / 2);
      expect(frame.centerY).toBe(0);
      // Nothing excluded on either side → no mask needed on either side,
      // regardless of how much margin admitting the whole set happened to leave.
      expect(frame.maskLeft).toBe(0);
      expect(frame.maskRight).toBe(0);
    });

    it("admits exactly at the boundary (full span === viewW − 2×FRAME_PADDING)", () => {
      const fullSpan = 3 * COL + NODE_W; // cols(-3..0)
      const viewW = fullSpan + FRAME_PADDING * 2;
      const frame = computeDefaultFrame(cols(-3, -2, -1, 0), viewW, 200);
      expect(frame.kind).toBe("window");
      if (frame.kind !== "window") return;
      expect(frame.hiddenLeft).toBe(0);
      expect(frame.hiddenRight).toBe(0);
      expect(frame.maskLeft).toBe(0);
      expect(frame.maskRight).toBe(0);
    });

    it("does not admit one pixel past the boundary: falls back to the pill-gutter-reserving window", () => {
      const fullSpan = 3 * COL + NODE_W; // cols(-3..0)
      const viewW = fullSpan + FRAME_PADDING * 2 - 1;
      const frame = computeDefaultFrame(cols(-3, -2, -1, 0), viewW, 200);
      expect(frame.kind).toBe("window");
      if (frame.kind !== "window") return;
      expect(frame.hiddenLeft + frame.hiddenRight).toBeGreaterThan(0);
    });
  });
});

describe("visibility", () => {
  const vp = { x: 0, y: 0, zoom: 1 };
  it("isNodeVisible is true only when the whole chip is inside the viewport", () => {
    expect(isNodeVisible({ x: 10, y: 10 }, vp, 500, 300)).toBe(true);
    expect(isNodeVisible({ x: 500 - NODE_W + 1, y: 10 }, vp, 500, 300)).toBe(false);
    expect(isNodeVisible({ x: -1, y: 10 }, vp, 500, 300)).toBe(false);
  });
  it("isPathVisible requires every node visible and a non-empty path", () => {
    expect(isPathVisible([{ x: 10, y: 10 }, { x: 200, y: 10 }], vp, 500, 300)).toBe(true);
    expect(isPathVisible([{ x: 10, y: 10 }, { x: 490, y: 10 }], vp, 500, 300)).toBe(false);
    expect(isPathVisible([], vp, 500, 300)).toBe(false);
  });
});

describe("hiddenColumns (live pills)", () => {
  const items = cols(-2, -1, 0, 1);

  it("counts a sliver-visible excluded column as hidden (a 12px sliver)", () => {
    // 592px pane, window framed columns −1..0, entry column −2 leaks a 12px sliver
    expect(hiddenColumns(cols(-2, -1, 0), { x: 332, y: 0, zoom: 1 }, 592)).toEqual({ left: 1, right: 0 });
  });

  it("counts a column hidden when it has zero overlap with the viewport", () => {
    // Screen x of column c is c*COL*zoom + vp.x. With vp.x = 2*COL, column −2
    // spans exactly [0, NODE_W] on screen → fully (if barely) visible.
    expect(hiddenColumns(items, { x: 2 * COL, y: 0, zoom: 1 }, 10_000)).toEqual({ left: 0, right: 0 });
    // One more pixel of leftward content shift puts its right edge at 0 → zero
    // overlap, well under the half-chip threshold → hidden.
    expect(hiddenColumns(items, { x: 2 * COL - NODE_W, y: 0, zoom: 1 }, 10_000).left).toBe(1);
  });

  it("counts columns hidden on the right when less than half their chip is visible", () => {
    // Column 1 starts at screen COL with vp.x = 0 → fully hidden when viewW <= COL.
    expect(hiddenColumns(items, { x: 0, y: 0, zoom: 1 }, COL).right).toBe(1);
    // A 10px sliver (< half a 176px chip = 88px) still counts as hidden, so a
    // sliver never clears a column's pill.
    expect(hiddenColumns(items, { x: 0, y: 0, zoom: 1 }, COL + 10).right).toBe(1);
    // At least half the chip visible (88px) is genuinely visible, not hidden.
    expect(hiddenColumns(items, { x: 0, y: 0, zoom: 1 }, COL + NODE_W / 2).right).toBe(0);
  });

  it("a column with at least half its chip visible is not hidden (threshold boundary)", () => {
    // Column −2 spans screen [l, l+176]; pick vp.x so exactly 88px (half the
    // chip) sits inside [0, viewW] → the boundary itself is not hidden.
    expect(hiddenColumns(cols(-2), { x: 408, y: 0, zoom: 1 }, 10_000)).toEqual({ left: 0, right: 0 });
    // 1px less visible tips it under the threshold → hidden, midpoint left of
    // center → counted left.
    expect(hiddenColumns(cols(-2), { x: 407, y: 0, zoom: 1 }, 10_000)).toEqual({ left: 1, right: 0 });
  });

  it("respects zoom when computing the visibility threshold", () => {
    // At zoom 0.5, column −4's right edge is (−4*COL + NODE_W) * 0.5 + vp.x;
    // vp.x = 2*COL puts it at NODE_W/2 > 0, well past the halved threshold → visible.
    expect(hiddenColumns(cols(-4, 0), { x: 2 * COL, y: 0, zoom: 0.5 }, 1000).left).toBe(0);
    expect(hiddenColumns(cols(-4, 0), { x: 2 * COL - NODE_W / 2, y: 0, zoom: 0.5 }, 1000).left).toBe(1);
    // Threshold itself halves with zoom: 44px (not 88px) is the zoom-0.5 boundary.
    expect(hiddenColumns(cols(-4), { x: 452, y: 0, zoom: 0.5 }, 10_000)).toEqual({ left: 0, right: 0 });
    expect(hiddenColumns(cols(-4), { x: 451, y: 0, zoom: 0.5 }, 10_000)).toEqual({ left: 1, right: 0 });
  });

  it("no-ops on a zero-width viewport (jsdom / not-yet-measured element)", () => {
    expect(hiddenColumns(items, { x: 0, y: 0, zoom: 1 }, 0)).toEqual({ left: 0, right: 0 });
  });
});

describe("computeRowBudget", () => {
  it("derives a smaller budget from a shorter pane, clamped to [MIN_ROW_BUDGET, COLUMN_CAP]", () => {
    expect(computeRowBudget(1000)).toBe(COLUMN_CAP);
    expect(computeRowBudget(0)).toBe(MIN_ROW_BUDGET);
  });

  it("shrinks as the pane shortens", () => {
    expect(computeRowBudget(800)).toBeLessThanOrEqual(computeRowBudget(1000));
    expect(computeRowBudget(300)).toBeLessThan(computeRowBudget(800));
  });

  // computeLayout can render one row past the budget when the overflow is
  // exactly one item (graph-layout.ts's "no +1 more" rule), so the pane a
  // budget implies must have room for budget+1 rows.
  it("framing invariant: the pane height a budget implies always fits the worst-case (budget + 1) row count", () => {
    for (const budget of [MIN_ROW_BUDGET, 5, 8, COLUMN_CAP]) {
      const worstCaseRows = budget + 1;
      const columnH = worstCaseRows * NODE_H + (worstCaseRows - 1) * GAP_Y;
      const paneHeight = columnH + LABEL_CLEARANCE;
      expect(computeRowBudget(paneHeight)).toBeGreaterThanOrEqual(budget);
    }
  });
});

describe("computeChipWidth", () => {
  // Three columns (parents, focus, children) at the computed width, framed in
  // a pane of that width.
  const frameOfThreeColumns = (paneWidth: number, chipWidth: number) =>
    computeDefaultFrame(
      [-1, 0, 1].map((level) => ({ x: level * (chipWidth + GAP_X), y: 0 })),
      paneWidth,
      600,
      READABLE_ZOOM,
      chipWidth,
    ).kind;

  it.each([
    [0, NODE_W, "fit"],
    [779, NODE_W, "window"],
    [822, 188, "fit"],
    [982, 234, "fit"],
    [1300, MAX_NODE_W, "fit"],
  ] as const)("a %i px pane gets %i px chips, and three columns %s", (paneWidth, chipWidth, frame) => {
    expect(computeChipWidth(paneWidth)).toBe(chipWidth);
    expect(frameOfThreeColumns(paneWidth, chipWidth)).toBe(frame);
  });
});

describe("edgePillCopy: the visible label is always the directional count, tooltip/aria name the remedy", () => {
  it("at the default frame, the label is the directional count and the tooltip/aria offer to show everything instead of re-applying the frame the user is already in", () => {
    expect(edgePillCopy("left", 1, true)).toEqual({
      label: "← 1 more",
      ariaLabel: "1 more column off screen to the left, show all",
      remedy: "showAll",
    });
    expect(edgePillCopy("right", 3, true)).toEqual({
      label: "3 more →",
      ariaLabel: "3 more columns off screen to the right, show all",
      remedy: "showAll",
    });
  });

  it("after a free pan/zoom away from the default frame, the label is unchanged and the tooltip/aria offer to reset back to it", () => {
    expect(edgePillCopy("left", 1, false)).toEqual({
      label: "← 1 more",
      ariaLabel: "1 more column off screen to the left, reset view",
      remedy: "resetView",
    });
    expect(edgePillCopy("right", 3, false)).toEqual({
      label: "3 more →",
      ariaLabel: "3 more columns off screen to the right, reset view",
      remedy: "resetView",
    });
  });
});

describe("gutterMaskWidth tracks the live zoom", () => {
  // Mirrors composition-canvas.tsx's ReactFlow minZoom/maxZoom props.
  const MIN_ZOOM = 0.35;
  const MAX_ZOOM = 1.5;

  it("never covers less than hiddenColumns()'s sliver bound (NODE_W * zoom / 2) across the zoom range", () => {
    for (const zoom of [MIN_ZOOM, WINDOW_ZOOM, 1.25, MAX_ZOOM]) {
      expect(gutterMaskWidth(zoom)).toBeGreaterThanOrEqual((NODE_W * zoom) / 2);
    }
  });

  it("equals FRAME_PADDING + PILL_GUTTER at WINDOW_ZOOM", () => {
    expect(gutterMaskWidth(WINDOW_ZOOM)).toBe(FRAME_PADDING + PILL_GUTTER);
  });
});

describe("frame exclusion vs hiddenColumns", () => {
  it("hiddenColumns reads an excluded column's bleed as visible at the default frame, so the frame's own counts win there", () => {
    // 5 columns; a pane too narrow for all of them.
    const items = cols(-2, -1, 0, 1, 2);
    const viewW = 1054;
    const frame = computeDefaultFrame(items, viewW, 600);
    expect(frame.kind).toBe("window");
    if (frame.kind !== "window") return;
    expect(frame.hiddenLeft + frame.hiddenRight).toBeGreaterThan(0);

    // The viewport the canvas actually applies for that frame: setCenter puts
    // frame.centerX at the pane's midpoint, at frame.zoom.
    const vp = {
      x: viewW / 2 - frame.centerX * frame.zoom,
      y: 0,
      zoom: frame.zoom,
    };
    const reported = hiddenColumns(items, vp, viewW);

    // The excluded columns bleed in past hiddenColumns' half-chip threshold,
    // so it reports nothing hidden; the canvas keeps the frame's counts here.
    expect(reported.left + reported.right).toBe(0);
  });
});

describe("computeDefaultFrame maskLeft/maskRight", () => {
  // `M` is the margin between a pane edge and the nearest included column's
  // leading edge, the same on both sides because the window is centered on the
  // included span. The nearest excluded column sits one column pitch
  // (NODE_W + GAP_X) further out, so its bleed past the pane edge is
  // `M - GAP_X`. maskLeft and maskRight equal that, and since GAP_X > 0 it is
  // always less than `M`, which keeps the mask off the included column.

  it("masks M − GAP_X past an excluded column: M=155, GAP_X=72 gives 83px", () => {
    // Constructed so the window admits exactly 2 of 4 columns (-1..0), which
    // leaves margin M = (viewW - windowSpan) / 2 = 155 on both sides.
    const windowSpan = COL + NODE_W; // columns -1..0
    const M = 155;
    const viewW = windowSpan + 2 * M;
    const frame = computeDefaultFrame(cols(-3, -2, -1, 0), viewW, 200);
    expect(frame.kind).toBe("window");
    if (frame.kind !== "window") return;
    expect(frame.hiddenLeft).toBe(2); // columns -3, -2 excluded
    expect(frame.hiddenRight).toBe(0);
    expect(frame.maskLeft).toBe(M - GAP_X); // 155 - 72 = 83
    expect(frame.maskRight).toBe(0); // nothing hidden right → no mask needed there
  });

  it("invariant: the mask can never reach the included column it borders (maskLeft/maskRight is always strictly less than the frame's own margin)", () => {
    const cases: Array<{ items: ReturnType<typeof cols>; viewW: number }> = [
      { items: cols(-5, -4, -3, -2, -1, 0), viewW: Math.ceil((2 * COL + NODE_W) * WINDOW_ZOOM) + RESERVED + 12 },
      { items: cols(-3, -2, -1, 0, 1), viewW: Math.ceil((COL + NODE_W) * WINDOW_ZOOM) + RESERVED + 1 },
      { items: cols(0, 1, 2, 3, 4, 5), viewW: Math.ceil((2 * COL + NODE_W) * WINDOW_ZOOM) + RESERVED + 12 },
    ];
    for (const { items, viewW } of cases) {
      const frame = computeDefaultFrame(items, viewW, 200);
      if (frame.kind !== "window") throw new Error("expected window");
      // Independently recover the frame's own margin from its output: the
      // included span's left edge is `frame.centerX - windowSpan/2`, and
      // `hiddenLeft` tells us which sorted column that is.
      const sortedCols = [...new Set(items.map((i) => i.x))].sort((a, b) => a - b);
      const includedLeftX = sortedCols[frame.hiddenLeft] as number;
      const margin = viewW / 2 - (frame.centerX - includedLeftX);
      if (frame.hiddenLeft > 0) expect(frame.maskLeft).toBeLessThan(margin);
      if (frame.hiddenRight > 0) expect(frame.maskRight).toBeLessThan(margin);
    }
  });
});

describe("distinctTails", () => {
  const VIDEO = [
    "apps/web/app/(use-page-wrapper)/video/meeting-not-started/[uid]/page.tsx",
    "apps/web/app/(use-page-wrapper)/video/meeting-ended/[uid]/page.tsx",
    "apps/web/app/(use-page-wrapper)/video/[uid]/page.tsx",
  ];

  it("grows the tail until every row is distinguishable", () => {
    const out = distinctTails(VIDEO);
    expect(new Set(out).size).toBe(3);
  });

  it("keeps short tails for paths that are already unique", () => {
    const out = distinctTails(["packages/ui/components/button/Button.tsx", "apps/web/modules/shell/Shell.tsx"]);
    expect(out).toEqual(["…/button/Button.tsx", "…/shell/Shell.tsx"]);
  });

  it("is index-aligned with its input", () => {
    expect(distinctTails(VIDEO)).toHaveLength(VIDEO.length);
  });

  it("leaves genuinely identical paths identical", () => {
    expect(distinctTails(["a/b/c.tsx", "a/b/c.tsx"])).toEqual(["…/b/c.tsx", "…/b/c.tsx"]);
  });

  it("handles empty and single inputs", () => {
    expect(distinctTails([])).toEqual([]);
    expect(distinctTails(["x/y/z.tsx"])).toEqual(["…/y/z.tsx"]);
  });

  it("returns a short path unchanged", () => {
    expect(distinctTails(["Button.tsx"])).toEqual(["Button.tsx"]);
  });
});

describe("shouldRecomputeEdgeAffordances", () => {
  it("does not recompute at the default frame", () => {
    expect(shouldRecomputeEdgeAffordances(true, false)).toBe(false);
  });

  it("recomputes after a user-driven pan/zoom away from the default frame", () => {
    expect(shouldRecomputeEdgeAffordances(false, false)).toBe(true);
  });

  it("never recomputes while a trace is pinned, even away from the default frame", () => {
    expect(shouldRecomputeEdgeAffordances(false, true)).toBe(false);
  });

  it("never recomputes while pinned and at the default frame", () => {
    expect(shouldRecomputeEdgeAffordances(true, true)).toBe(false);
  });
});

describe("chipFaceFragments", () => {
  it("leaves unique names alone", () => {
    expect(chipFaceFragments([{ name: "A", path: "src/a.tsx" }, { name: "B", path: "src/b.tsx" }])).toEqual([
      null,
      null,
    ]);
  });
  it("gives the distinguishing directory when two chips share a name and a file name; an unrelated name gets null", () => {
    expect(
      chipFaceFragments([
        { name: "ServerPage", path: "apps/web/app/(use)/[type]/page.tsx" },
        { name: "ServerPage", path: "apps/web/app/(use)/[id]/page.tsx" },
        { name: "Other", path: "src/o.tsx" },
      ]),
    ).toEqual(["[type]", "[id]", null]);
  });
  it("keeps the file name when that is what differs", () => {
    expect(
      chipFaceFragments([
        { name: "Page", path: "src/x/Page.tsx" },
        { name: "Page", path: "src/x/page.tsx" },
      ]),
    ).toEqual(["x/Page.tsx", "x/page.tsx"]);
  });
  it("identical paths stay bare: they are the same file", () => {
    expect(chipFaceFragments([{ name: "A", path: "src/a.tsx" }, { name: "A", path: "src/a.tsx" }])).toEqual([
      null,
      null,
    ]);
  });
  it("a collider with an empty path gets null while its sibling with a real path gets a fragment", () => {
    expect(
      chipFaceFragments([
        { name: "A", path: "" },
        { name: "A", path: "src/a.tsx" },
      ]),
    ).toEqual([null, "src/a.tsx"]);
  });
});
