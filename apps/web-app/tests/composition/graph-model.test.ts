import { describe, it, expect } from "vitest";
import type { CompositionGraph, CompositionGraphNode } from "@scoutui/web-shared";
import {
  buildGraphModel, chipFaceFragments, distinctTails, findRows, pathValueOf, routeIds, routesFrom, routeThrough,
  topLevelIds, topsThrough, type GraphModel,
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

  it("writes each route in render order, the outermost component first, with the uses at each step", () => {
    const m2 = buildGraphModel(graph(
      [node("F"), node("mid"), node("root"), node("kid")],
      [["root", "mid", 3], ["mid", "F", 5], ["F", "kid", 2]],
    ));
    expect(rows(m2, "up").map((r) => [r.chain, r.uses])).toEqual([[["mid", "F"], [5]], [["root", "mid", "F"], [3, 5]]]);
    expect(rows(m2, "down").map((r) => [r.chain, r.uses])).toEqual([[["F", "kid"], [2]]]);
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

describe("the two ends", () => {
  // T0 → M → D → F, T1 → D, T2 → F, and L0 ⇄ L1 → F: a loop nothing outside renders.
  const m = buildGraphModel(
    graph(
      ["F", "D", "M", "T0", "T1", "T2", "L0", "L1"].map((id) => node(id)),
      [["T0", "M"], ["M", "D"], ["D", "F"], ["T1", "D"], ["T2", "F"], ["L0", "L1"], ["L1", "L0"], ["L1", "F"]],
    ),
  );
  const up = routesFrom(m, "F", "up");

  it("lists the top-level components above the focus, and leaves out a loop nothing outside renders", () => {
    expect(topLevelIds(m, "F", up).sort()).toEqual(["T0", "T1", "T2"]);
  });

  it("counts a component that renders only itself as top level", () => {
    const self = buildGraphModel(graph([node("F"), node("P")], [["P", "P"], ["P", "F"]]));
    expect(topLevelIds(self, "F", routesFrom(self, "F", "up"))).toEqual(["P"]);
  });

  it("keeps the tops a route through a component reaches, with their steps through it", () => {
    expect(topsThrough(m, "F", up, "D")).toEqual(new Map([["T1", 2], ["T0", 3]]));
    expect(topsThrough(m, "F", up, "M")).toEqual(new Map([["T0", 3]]));
  });

  it("keeps a top-level through-component as its own top", () => {
    expect(topsThrough(m, "F", up, "T2")).toEqual(new Map([["T2", 1]]));
  });

  it("finds no tops through a loop nothing outside renders", () => {
    expect(topsThrough(m, "F", up, "L1")).toEqual(new Map());
  });

  it.each([
    ["a top alone", null, "T0", ["T0", "M", "D", "F"]],
    ["a through-component alone", "M", null, ["M", "D", "F"]],
    ["both", "D", "T0", ["T0", "M", "D", "F"]],
    ["nothing", null, null, []],
    ["a top the through-component doesn't reach", "M", "T1", []],
  ])("draws the route for %s", (_, via, top, ids) => {
    expect(routeThrough(m, "F", up, via, top)).toEqual(ids);
  });

  it("takes the shortest route through the component, not the shortest overall", () => {
    // T → X → F is shorter, but the route must run through Y: T → Y → Z → F.
    const g = buildGraphModel(
      graph(["F", "T", "X", "Y", "Z"].map((id) => node(id)), [["T", "X"], ["X", "F"], ["T", "Y"], ["Y", "Z"], ["Z", "F"]]),
    );
    expect(routeThrough(g, "F", routesFrom(g, "F", "up"), "Y", "T")).toEqual(["T", "Y", "Z", "F"]);
  });

  it("keeps a route that only passes a loop", () => {
    // A ⇄ V, V → F, T → A: through A the route is T → A → V → F.
    const g = buildGraphModel(graph(["F", "V", "A", "T"].map((id) => node(id)), [["A", "V"], ["V", "A"], ["V", "F"], ["T", "A"]]));
    expect(routeThrough(g, "F", routesFrom(g, "F", "up"), "A", "T")).toEqual(["T", "A", "V", "F"]);
  });

  it("leaves out a top whose only route through the component goes round a loop", () => {
    // T → V, V ⇄ A, V → F: through A, T's route would be T → V → A → V → F.
    const g = buildGraphModel(graph(["F", "V", "A", "T"].map((id) => node(id)), [["T", "V"], ["V", "A"], ["A", "V"], ["V", "F"]]));
    const gUp = routesFrom(g, "F", "up");
    expect(topsThrough(g, "F", gUp, "A")).toEqual(new Map());
    expect(routeThrough(g, "F", gUp, "A", "T")).toEqual([]);
  });
});
