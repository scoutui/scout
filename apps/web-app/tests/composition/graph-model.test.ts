import { describe, it, expect } from "vitest";
import type { CompositionGraph, CompositionGraphNode } from "@scoutui/web-shared";
import {
  buildGraphModel, chipFaceFragments, distinctTails, findRows, pathValueOf, realRoute, routeIds, routesFrom, type GraphModel,
} from "@/components/component-detail/composition/graph-model";

const node = (id: string, o?: Partial<CompositionGraphNode>): CompositionGraphNode => ({
  id, displayName: id, packageName: null, filePath: `src/${id}.tsx`,
  scope: "local", deprecated: false, occurrenceCount: 1, ...o,
});
const graph = (nodes: CompositionGraphNode[], edges: [string, string, number?][]): CompositionGraph => ({
  nodes, edges: edges.map(([source, target, count]) => ({ source, target, count: count ?? 1 })),
});

describe("buildGraphModel", () => {
  it("builds both adjacency directions and skips edges with missing endpoints", () => {
    const m = buildGraphModel(graph([node("a"), node("b")], [["a", "b", 2], ["a", "ghost"]]));
    expect(m.childrenOf.get("a")).toEqual([{ id: "b", count: 2 }]);
    expect(m.parentsOf.get("b")).toEqual([{ id: "a", count: 2 }]);
    expect(m.childrenOf.get("ghost")).toBeUndefined();
  });
});

describe("routeIds", () => {
  const m = buildGraphModel(graph(
    [node("a"), node("b"), node("c"), node("d")],
    [["a", "b"], ["b", "c"], ["c", "d"]],
  ));
  it("runs from the component to the focus inclusive, empty when unreachable", () => {
    const down = routesFrom(m, "a", "down");
    expect(routeIds(down, "a", "c")).toEqual(["c", "b", "a"]);
    expect(routeIds(down, "a", "a")).toEqual(["a"]);
    expect(routeIds(routesFrom(m, "c", "down"), "c", "a")).toEqual([]);
  });
});

describe("pathValueOf", () => {
  // The rail, the chip tooltip and the chip's accessible name all read the path
  // through this function.
  it("falls back to packageName for a local node with no filePath", () => {
    const n = node("x", { filePath: null, packageName: "@acme/pkg" });
    expect(pathValueOf(n)).toBe("@acme/pkg");
  });

  it("prefers filePath over packageName for a local node when both are set", () => {
    const n = node("x", { filePath: "src/x.tsx", packageName: "@acme/pkg" });
    expect(pathValueOf(n)).toBe("src/x.tsx");
  });

  it("uses packageName for an external node regardless of filePath", () => {
    const n = node("x", { scope: "external", filePath: "src/x.tsx", packageName: "@acme/pkg" });
    expect(pathValueOf(n)).toBe("@acme/pkg");
  });

  it("returns an empty string when a local node has neither", () => {
    const n = node("x", { filePath: null, packageName: null });
    expect(pathValueOf(n)).toBe("");
  });
});

const rows = (m: GraphModel, dir: "up" | "down") => findRows(m, "F", routesFrom(m, "F", dir), dir);

describe("findRows", () => {
  // root → mid → F; root2 → F (3 call sites); root3 → F (1 call site).
  // root2 and root3 tie on steps, so their uses of F decide their order, not
  // their repo-wide uses, which run the other way (root3: 9 > root2: 5).
  const m = buildGraphModel(graph(
    [node("root"), node("root2", { occurrenceCount: 5 }), node("root3", { occurrenceCount: 9 }),
     node("mid"), node("F"), node("kid"), node("grandkid")],
    [["root", "mid"], ["mid", "F"], ["root2", "F", 3], ["root3", "F", 1],
     ["F", "kid"], ["kid", "grandkid"]],
  ));

  it("up: everything that renders the focus, nearest first, uses of the focus deciding a tie", () => {
    expect(rows(m, "up").map((r) => [r.node.id, r.steps])).toEqual([
      ["root2", 1], ["root3", 1], ["mid", 1], ["root", 2],
    ]);
  });

  it("down: everything the focus renders, nearest first", () => {
    expect(rows(m, "down").map((r) => [r.node.id, r.steps])).toEqual([
      ["kid", 1], ["grandkid", 2],
    ]);
  });

  it("falls through to repo-wide uses, then name, when uses of the focus tie", () => {
    const m2 = buildGraphModel(graph(
      [node("F"), node("b", { occurrenceCount: 9 }), node("c", { occurrenceCount: 2 }),
       node("a", { occurrenceCount: 2 })],
      [["b", "F"], ["c", "F"], ["a", "F"]],
    ));
    expect(rows(m2, "up").map((r) => r.node.id)).toEqual(["b", "a", "c"]);
  });

  it("terminates on a cycle, settling each node at its shortest distance", () => {
    // F → Z → W → F: every node is both above and below the focus.
    const m2 = buildGraphModel(graph(
      [node("F"), node("Z"), node("W")],
      [["F", "Z"], ["Z", "W"], ["W", "F"]],
    ));
    expect(rows(m2, "up").map((r) => [r.node.id, r.steps])).toEqual([["W", 1], ["Z", 2]]);
    expect(rows(m2, "down").map((r) => [r.node.id, r.steps])).toEqual([["Z", 1], ["W", 2]]);
  });

  it("never lists the focus, even with a self-render edge", () => {
    const m2 = buildGraphModel(graph([node("F")], [["F", "F"]]));
    expect(rows(m2, "up")).toEqual([]);
    expect(rows(m2, "down")).toEqual([]);
  });

  it("writes each route in render order, the outermost component first", () => {
    const m2 = buildGraphModel(graph(
      [node("F"), node("mid"), node("root"), node("kid")],
      [["root", "mid", 3], ["mid", "F", 5], ["F", "kid", 2]],
    ));
    expect(rows(m2, "up").map((r) => [r.chain, r.route])).toEqual([
      [["mid", "F"], ["mid"]],
      [["root", "mid", "F"], ["mid", "root"]],
    ]);
    expect(rows(m2, "down").map((r) => [r.chain, r.route])).toEqual([[["F", "kid"], ["kid"]]]);
  });
});

describe("realRoute", () => {
  // d0 and d1 render F; d1 also renders d0, and p0 renders d0. X renders F,
  // Y renders X, and X renders Y. F renders kid, and kid renders d0.
  const m = buildGraphModel(graph(
    ["F", "d0", "d1", "p0", "X", "Y", "kid"].map((id) => node(id)),
    [["d0", "F"], ["d1", "F"], ["d1", "d0"], ["p0", "d0"], ["X", "F"], ["Y", "X"], ["X", "Y"], ["F", "kid"], ["kid", "d0"]],
  ));
  it.each([
    ["a route whose every step renders the one before", "up", ["d0", "p0"], ["d0", "p0"]],
    ["a route through a component that also renders F directly", "up", ["d0", "d1"], ["d0", "d1"]],
    ["a first step that doesn't render F", "up", ["p0"], []],
    ["a step that doesn't render the one before", "up", ["d0", "Y"], ["d0"]],
    ["a component the graph doesn't have", "up", ["d0", "gone"], ["d0"]],
    ["a component already on the route", "up", ["X", "Y", "X"], ["X", "Y"]],
    ["the focus", "down", ["kid", "d0", "F"], ["kid", "d0"]],
    ["a route of what F renders", "down", ["kid", "d0"], ["kid", "d0"]],
  ] as const)("keeps the steps that are real, up to the first that isn't: %s", (_, dir, ids, kept) => {
    expect(realRoute(m, "F", dir, ids)).toEqual(kept);
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
