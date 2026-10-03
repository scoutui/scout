import { describe, it, expect } from "vitest";
import type { CompositionGraphNode } from "@scoutui/web-shared";
import { buildGraphModel, closureOf, type GraphModel } from "@/components/component-detail/composition/graph-model";
import {
  COLUMN_CAP, GAP_X, GAP_Y, NODE_H, NODE_W, computeLayout, edgeWidth, type PinnedEntry,
} from "@/components/component-detail/composition/graph-layout";
import { structuredFixture, dualRouteFixture, tinyFixture, downwardFixture, node, graph } from "./graph-fixtures";

const layoutOf = (m: GraphModel, focusId: string, pinned: PinnedEntry[] | null = null, rowBudget?: number) =>
  computeLayout(m, focusId, { pinned }, rowBudget);
const owners = (n: number, extra?: (i: number) => Partial<CompositionGraphNode>) =>
  Array.from({ length: n }, (_, i) => node(`o${i}`, extra?.(i)));
const withFocusEdges = (ownerNodes: CompositionGraphNode[], count: (i: number) => number = () => 1) =>
  buildGraphModel(graph([...ownerNodes, node("F")], ownerNodes.map((o, i) => [o.id, "F", count(i)] as [string, string, number])));
const COL = NODE_W + GAP_X;
const chipX = (items: ReturnType<typeof layoutOf>["items"], id: string) =>
  items.find((i) => i.kind === "chip" && i.node.id === id)?.x;

describe("1-hop neighbourhood at rest", () => {
  it("direct parents sit at −1, direct children at +1, nothing further out", () => {
    const { graph: g } = structuredFixture(); // roots r0..r11 → A/B/c9..c11 → F
    const m = buildGraphModel(g);
    const { items } = layoutOf(m, "F");
    expect(chipX(items, "A")).toBe(-COL);
    expect(chipX(items, "B")).toBe(-COL);
    expect(chipX(items, "c9")).toBe(-COL);
    expect(chipX(items, "r0")).toBeUndefined(); // a root two hops up is not drawn
    expect(Math.min(...items.map((i) => i.x))).toBe(-COL);
  });

  it("children sit at +1 even when one child renders another (no layering)", () => {
    const m = buildGraphModel(graph([node("F"), node("A"), node("B")], [["F", "A"], ["F", "B"], ["A", "B"]]));
    const { items, edges } = layoutOf(m, "F");
    expect(chipX(items, "A")).toBe(COL);
    expect(chipX(items, "B")).toBe(COL);
    // The sibling edge A→B is real but is never drawn within a column.
    expect(edges.map((e) => e.id).sort()).toEqual(["F>A", "F>B"]);
  });

  it("a parent that also renders a child draws no edge that skips the focus", () => {
    const m = buildGraphModel(graph([node("P"), node("F"), node("C")], [["P", "F"], ["F", "C"], ["P", "C"]]));
    const { edges } = layoutOf(m, "F");
    expect(edges.map((e) => e.id).sort()).toEqual(["F>C", "P>F"]);
  });

  it("pure root has no −1 column; pure leaf has no +1 column", () => {
    const root = buildGraphModel(graph([node("F"), node("c")], [["F", "c"]]));
    expect(layoutOf(root, "F").items.every((i) => i.x >= 0)).toBe(true);
    const leaf = buildGraphModel(graph([node("p"), node("F")], [["p", "F"]]));
    expect(layoutOf(leaf, "F").items.every((i) => i.x <= 0)).toBe(true);
  });

  it("a self-recursive focus draws one focus chip and no self edge", () => {
    const m = buildGraphModel(graph([node("F"), node("K")], [["F", "F"], ["F", "K"]]));
    const { items, edges } = layoutOf(m, "F");
    expect(items.filter((i) => i.kind === "chip" && i.node.id === "F")).toHaveLength(1);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(edges.map((e) => e.id)).toEqual(["F>K"]);
  });

  it("a node reachable both ways (F ⇄ X) is drawn once, on the owner side", () => {
    const m = buildGraphModel(graph([node("F"), node("X")], [["X", "F"], ["F", "X"]]));
    const { items } = layoutOf(m, "F");
    expect(items.filter((i) => i.kind === "chip" && i.node.id === "X")).toHaveLength(1);
    expect(chipX(items, "X")).toBe(-COL);
  });

  it("a 2-hop descendant is not drawn at rest", () => {
    const { graph: g } = downwardFixture(); // F → A, F → B, A → C, C → D
    const m = buildGraphModel(g);
    const { items } = layoutOf(m, "F");
    expect(chipX(items, "C")).toBeUndefined();
    expect(Math.max(...items.map((i) => i.x))).toBe(COL);
  });
});

describe("column sort and paging", () => {
  it("sorts a column by call sites against the focus, then occurrence, then name", () => {
    const m = withFocusEdges(owners(3, (i) => ({ occurrenceCount: i })), (i) => [1, 5, 5][i] as number);
    const col = layoutOf(m, "F").items.filter((i) => i.x === -COL);
    // o2 (5 call sites, occurrence 2) above o1 (5, occurrence 1) above o0 (1)
    expect(col.map((i) => (i.kind === "chip" ? i.node.id : i.id))).toEqual(["o2", "o1", "o0"]);
  });

  it("a column shows the same components in the same order as the list, and folds the list's later rows", () => {
    // Every owner ties on call sites and occurrences; ids sort the opposite way to names.
    const n = COLUMN_CAP + 2;
    const m = withFocusEdges(owners(n, (i) => ({ displayName: String.fromCharCode(65 + n - 1 - i) })));
    const listIds = closureOf(m, "F", "up").map((r) => r.node.id);
    const col = layoutOf(m, "F").items.filter((i) => i.x === -COL);
    expect(col.flatMap((i) => (i.kind === "chip" ? [i.node.id] : []))).toEqual(listIds.slice(0, COLUMN_CAP));
    const more = col.find((i) => i.kind === "more");
    expect(more?.kind === "more" && more.nodes.map((x) => x.id)).toEqual(listIds.slice(COLUMN_CAP));
  });

  it("caps a column at COLUMN_CAP and folds overflow into one '+N more components' chip that keeps the hidden edges", () => {
    const m = withFocusEdges(owners(14, (i) => ({ occurrenceCount: 14 - i })));
    const { items, edges } = layoutOf(m, "F");
    const col = items.filter((i) => i.x === -COL);
    expect(col.filter((i) => i.kind === "chip")).toHaveLength(COLUMN_CAP);
    const more = col.find((i) => i.kind === "more");
    expect(more?.kind === "more" && more.label).toBe("+4 more components");
    expect(more?.kind === "more" && more.nodes.length).toBe(4);
    const moreEdge = edges.find((e) => e.source === "more:-1" && e.target === "F");
    expect(moreEdge?.count).toBe(4);
  });

  it("renders the whole column when it exceeds the cap by exactly one (no '+1 more')", () => {
    const m = withFocusEdges(owners(COLUMN_CAP + 1));
    const col = layoutOf(m, "F").items.filter((i) => i.x === -COL);
    expect(col).toHaveLength(COLUMN_CAP + 1);
    expect(col.every((i) => i.kind === "chip")).toBe(true);
  });

  it("uses the singular for exactly one hidden member", () => {
    // Unpinned, `hiddenMembers.length` can never be 1: the "+1 more costs a row
    // to save a row" rule means the fold either doesn't trigger (0 hidden, at
    // COLUMN_CAP + 1 items) or triggers with >= 2 hidden. Pinning the lowest
    // tail item rescues it back into `visible`, leaving exactly one hidden.
    const n = COLUMN_CAP + 2;
    const m = withFocusEdges(owners(n, (i) => ({ occurrenceCount: n - i })));
    const { items } = layoutOf(m, "F", [{ id: "F", level: 0 }, { id: `o${n - 1}`, level: -1 }]);
    const more = items.find((i) => i.kind === "more");
    expect(more?.kind === "more" && more.nodes.map((x) => x.id)).toEqual([`o${n - 2}`]);
    expect(more?.kind === "more" && more.label).toBe("+1 more component");
  });

  it("a smaller row budget folds more; visible + hidden reconciles to the total", () => {
    const m = withFocusEdges(owners(14));
    const { items } = layoutOf(m, "F", null, 4);
    const col = items.filter((i) => i.x === -COL);
    const more = col.find((i) => i.kind === "more");
    expect(col.filter((i) => i.kind === "chip")).toHaveLength(4);
    expect(more?.kind === "more" && more.nodes.length).toBe(10);
  });

  it("the rendered side pages the same way", () => {
    const kids = owners(13);
    const m = buildGraphModel(graph([node("F"), ...kids], kids.map((k) => ["F", k.id] as [string, string])));
    const col = layoutOf(m, "F").items.filter((i) => i.x === COL);
    expect(col.filter((i) => i.kind === "chip")).toHaveLength(COLUMN_CAP);
    expect(col.find((i) => i.kind === "more")?.id).toBe("more:1");
  });
});

describe("displayIdOf", () => {
  it("maps drawn chips to themselves and hidden members to their more chip", () => {
    const m = withFocusEdges(owners(14, (i) => ({ occurrenceCount: 14 - i })));
    const { displayIdOf } = layoutOf(m, "F");
    expect(displayIdOf.get("o0")).toBe("o0");
    expect(displayIdOf.get("o13")).toBe("more:-1");
    expect(displayIdOf.get("F")).toBe("F");
    // Every member of a paged column maps to its own chip or the more chip; a
    // member mapping to nothing would drop its edges silently.
    for (let i = 0; i < 14; i++) expect(displayIdOf.get(`o${i}`)).toBeDefined();
  });
  it("every display id names an actual layout item", () => {
    const { graph: g } = structuredFixture();
    const { items, displayIdOf } = layoutOf(buildGraphModel(g), "F");
    const ids = new Set(items.map((i) => i.id));
    for (const display of displayIdOf.values()) expect(ids.has(display)).toBe(true);
  });
});

describe("pinned paths", () => {
  it("reveals upward intermediates one column outward per step; the −1 step keeps its column", () => {
    const { graph: g } = structuredFixture();
    const m = buildGraphModel(g);
    // F → A → r0 (path order focus → endpoint)
    const pinned: PinnedEntry[] = [{ id: "F", level: 0 }, { id: "A", level: -1 }, { id: "r0", level: -2 }];
    const { items, edges } = layoutOf(m, "F", pinned);
    expect(chipX(items, "A")).toBe(-COL);
    expect(chipX(items, "r0")).toBe(-2 * COL);
    expect(edges.some((e) => e.source === "r0" && e.target === "A")).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("a pinned −1 node beyond the cap stays visible without teleporting to the top", () => {
    const m = withFocusEdges(owners(14, (i) => ({ occurrenceCount: 14 - i })));
    const { items } = layoutOf(m, "F", [{ id: "F", level: 0 }, { id: "o13", level: -1 }]);
    const col = items.filter((i) => i.x === -COL && i.kind === "chip");
    expect(col.some((i) => i.kind === "chip" && i.node.id === "o13")).toBe(true);
    expect(col[0]?.kind === "chip" && col[0].node.id).toBe("o0");
    const more = items.find((i) => i.kind === "more");
    expect(more?.kind === "more" && more.nodes.map((n) => n.id)).not.toContain("o13");
  });

  it("reveals downward steps one column outward past the +1 child", () => {
    const { graph: g } = downwardFixture(); // F → A → C → D
    const m = buildGraphModel(g);
    const pinned: PinnedEntry[] = [{ id: "F", level: 0 }, { id: "A", level: 1 }, { id: "C", level: 2 }, { id: "D", level: 3 }];
    const { items, edges } = layoutOf(m, "F", pinned);
    expect(chipX(items, "A")).toBe(COL);
    expect(chipX(items, "C")).toBe(2 * COL);
    expect(chipX(items, "D")).toBe(3 * COL);
    expect(edges.map((e) => e.id).sort()).toEqual(["A>C", "C>D", "F>A", "F>B"]);
  });

  it("a downward pin onto an owner-side node draws it once, on the owner side", () => {
    const m = buildGraphModel(graph([node("F"), node("X"), node("Y")], [["X", "F"], ["F", "X"], ["X", "Y"]]));
    const { items } = layoutOf(m, "F", [{ id: "F", level: 0 }, { id: "X", level: 1 }, { id: "Y", level: 2 }]);
    expect(items.filter((i) => i.kind === "chip" && i.node.id === "X")).toHaveLength(1);
    expect(chipX(items, "X")).toBe(-COL);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  // Each revealed chip takes the y of the step it feeds into, so a pinned path
  // runs straight even when that step sits at the bottom of a full column.
  it("a revealed chip lines up with the rescued −1 row it feeds, not the column centre", () => {
    const owner13 = node("o13", { occurrenceCount: 1 });
    const g = graph(
      [...owners(13, (i) => ({ occurrenceCount: 14 - i })), owner13, node("F"), node("G")],
      [
        ...Array.from({ length: 13 }, (_, i) => [`o${i}`, "F", 1] as [string, string, number]),
        ["o13", "F", 1],
        ["G", "o13", 1],
      ],
    );
    const m = buildGraphModel(g);
    const pinned: PinnedEntry[] = [
      { id: "F", level: 0 },
      { id: "o13", level: -1 },
      { id: "G", level: -2 },
    ];
    const { items } = layoutOf(m, "F", pinned);
    const o13 = items.find((i) => i.kind === "chip" && i.node.id === "o13");
    const gChip = items.find((i) => i.kind === "chip" && i.node.id === "G");
    expect(chipX(items, "G")).toBe(-2 * COL);
    // o13 is the lightest owner, rescued to the bottom of the −1 column, well
    // below the centre a lone chip would otherwise take.
    expect(o13?.y).toBeGreaterThan(0);
    expect(gChip?.y).toBe(o13?.y);
  });

  it("downward mirror: every revealed step lands on the +1 row it feeds", () => {
    const { graph: g } = downwardFixture(); // F → A → C → D, and F → B
    const m = buildGraphModel(g);
    const pinned: PinnedEntry[] = [
      { id: "F", level: 0 },
      { id: "A", level: 1 },
      { id: "C", level: 2 },
      { id: "D", level: 3 },
    ];
    const { items } = layoutOf(m, "F", pinned);
    const yOf = (id: string) => items.find((i) => i.kind === "chip" && i.node.id === id)?.y;
    // A shares the +1 column with B, so it is off-centre: the revealed steps
    // must follow A's row, not y=0.
    expect(yOf("A")).not.toBe(0);
    expect(yOf("C")).toBe(yOf("A"));
    expect(yOf("D")).toBe(yOf("A"));
  });

  // A "+N more" chip stands for a bucket, not a component, so it draws only the
  // relationship it summarises: bucket ⇄ focus. An edge from a revealed chip
  // would read as the bucket looping back into its own column.
  it("a '+N more' chip connects only to the focus, never to a revealed chip", () => {
    const g = graph(
      [...owners(14, (i) => ({ occurrenceCount: 14 - i })), node("F"), node("G")],
      [
        ...Array.from({ length: 14 }, (_, i) => [`o${i}`, "F", 1] as [string, string, number]),
        ["G", "o13", 1], // o13 is rescued into the −1 column by the pin below
        ["G", "o12", 1], // o12 stays inside the "+N more" bucket
      ],
    );
    const m = buildGraphModel(g);
    const { items, edges } = layoutOf(m, "F", [
      { id: "F", level: 0 },
      { id: "o13", level: -1 },
      { id: "G", level: -2 },
    ]);
    // The fixture only bites while the bucket actually exists.
    expect(items.some((i) => i.kind === "more" && i.id === "more:-1")).toBe(true);
    expect(edges.some((e) => e.source === "G" && e.target === "o13")).toBe(true);
    expect(edges.some((e) => e.source === "more:-1" && e.target === "F")).toBe(true);
    expect(
      edges.filter((e) => e.id.includes("more:") && e.id !== "more:-1>F").map((e) => e.id),
    ).toEqual([]);
  });

  it("dual-route fixture: pinning a root that is also a direct parent keeps it at −1", () => {
    const { graph: g } = dualRouteFixture(); // r0..r2 render F directly and via P
    const m = buildGraphModel(g);
    const { items } = layoutOf(m, "F", [{ id: "F", level: 0 }, { id: "r0", level: -1 }]);
    expect(chipX(items, "r0")).toBe(-COL);
    expect(Math.min(...items.map((i) => i.x))).toBe(-COL);
  });
});

describe("geometry and integrity", () => {
  it("sorts items by x then y for DOM/tab order", () => {
    const m = buildGraphModel(tinyFixture().graph);
    const { items } = layoutOf(m, "F");
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1] as (typeof items)[number];
      const b = items[i] as (typeof items)[number];
      expect(a.x < b.x || (a.x === b.x && a.y <= b.y)).toBe(true);
    }
  });
  it("centers each column's slots around y=0", () => {
    const m = withFocusEdges(owners(3));
    const col = layoutOf(m, "F").items.filter((i) => i.x === -COL);
    const ys = col.map((i) => i.y);
    expect(Math.min(...ys)).toBe(-(3 * NODE_H + 2 * GAP_Y) / 2);
  });
  it("edges reference rendered items and never self-loop", () => {
    const { graph: g } = structuredFixture();
    const { items, edges } = layoutOf(buildGraphModel(g), "F");
    const ids = new Set(items.map((i) => i.id));
    for (const e of edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
      expect(e.source).not.toBe(e.target);
    }
  });
  it("edge width buckets, on both sides of every threshold", () => {
    expect(edgeWidth(1)).toBe(1);
    expect(edgeWidth(4)).toBe(1);
    expect(edgeWidth(5)).toBe(1.5);
    expect(edgeWidth(19)).toBe(1.5);
    expect(edgeWidth(20)).toBe(2);
    expect(edgeWidth(49)).toBe(2);
    expect(edgeWidth(50)).toBe(3);
  });
});
