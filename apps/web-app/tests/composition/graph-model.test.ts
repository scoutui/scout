import { describe, it, expect } from "vitest";
import type { CompositionGraph, CompositionGraphNode } from "@scoutui/web-shared";
import {
  buildGraphModel, closureOf, pathBetween, pathValueOf,
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

describe("pathBetween", () => {
  const m = buildGraphModel(graph(
    [node("a"), node("b"), node("c"), node("d")],
    [["a", "b"], ["b", "c"], ["c", "d"]],
  ));
  it("returns from→to inclusive, null when unreachable", () => {
    expect(pathBetween(m, "a", "c", m.childrenOf)).toEqual(["a", "b", "c"]);
    expect(pathBetween(m, "c", "a", m.childrenOf)).toBeNull();
    expect(pathBetween(m, "a", "a", m.childrenOf)).toEqual(["a"]);
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

describe("closureOf", () => {
  // root → mid → F; root2 → F (3 call sites); root3 → F (1 call site).
  // root2 and root3 tie on steps, so the call-site count against F decides
  // their order, not their repo-wide occurrence counts, which run the other
  // way (root3: 9 > root2: 5).
  const m = buildGraphModel(graph(
    [node("root"), node("root2", { occurrenceCount: 5 }), node("root3", { occurrenceCount: 9 }),
     node("mid"), node("F"), node("kid"), node("grandkid")],
    [["root", "mid"], ["mid", "F"], ["root2", "F", 3], ["root3", "F", 1],
     ["F", "kid"], ["kid", "grandkid"]],
  ));

  it("up: the whole upward closure, nearest first, call sites against the focus deciding a tie", () => {
    expect(closureOf(m, "F", "up").map((e) => [e.node.id, e.hops])).toEqual([
      ["root2", 1], ["root3", 1], ["mid", 1], ["root", 2],
    ]);
  });

  it("down: the whole downward closure, nearest first", () => {
    expect(closureOf(m, "F", "down").map((e) => [e.node.id, e.hops])).toEqual([
      ["kid", 1], ["grandkid", 2],
    ]);
  });

  it("falls through to occurrence count, then name, when call sites tie", () => {
    const m2 = buildGraphModel(graph(
      [node("F"), node("b", { occurrenceCount: 9 }), node("c", { occurrenceCount: 2 }),
       node("a", { occurrenceCount: 2 })],
      [["b", "F"], ["c", "F"], ["a", "F"]],
    ));
    expect(closureOf(m2, "F", "up").map((e) => e.node.id)).toEqual(["b", "a", "c"]);
  });

  it("terminates on a cycle, settling each node at its shortest distance", () => {
    // F → Z → W → F: every node is both above and below the focus.
    const m2 = buildGraphModel(graph(
      [node("F"), node("Z"), node("W")],
      [["F", "Z"], ["Z", "W"], ["W", "F"]],
    ));
    expect(closureOf(m2, "F", "up").map((e) => [e.node.id, e.hops])).toEqual([["W", 1], ["Z", 2]]);
    expect(closureOf(m2, "F", "down").map((e) => [e.node.id, e.hops])).toEqual([["Z", 1], ["W", 2]]);
  });

  it("never lists the focus in its own closure, even with a self-render edge", () => {
    const m2 = buildGraphModel(graph([node("F")], [["F", "F"]]));
    expect(closureOf(m2, "F", "up")).toEqual([]);
    expect(closureOf(m2, "F", "down")).toEqual([]);
  });
});
