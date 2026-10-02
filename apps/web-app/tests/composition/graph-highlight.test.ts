import { describe, it, expect } from "vitest";
import type { CompositionGraph, CompositionGraphNode } from "@scoutui/web-shared";
import { buildGraphModel } from "@/components/component-detail/composition/graph-model";
import { computeLayout } from "@/components/component-detail/composition/graph-layout";
import {
  deriveHighlight,
  edgeStyle,
  EDGE_Z_DIMMED,
  EDGE_Z_ON_CHAIN,
} from "@/components/component-detail/composition/graph-highlight";
// @xyflow/react stacks every edge and every node in one flattened z-index
// context (neither `.react-flow__edges` nor `.react-flow__nodes` creates its
// own), and every node in this canvas sits at zIndex 0. An edge zIndex
// reaching 0 would paint over chip surfaces, so both tiers stay negative, with
// on-chain above dimmed.
const NODE_Z = 0;
it("edge zIndex tiers never reach the node plane, and on-chain still clears dimmed", () => {
  expect(EDGE_Z_ON_CHAIN).toBeLessThan(NODE_Z);
  expect(EDGE_Z_DIMMED).toBeLessThan(NODE_Z);
  expect(EDGE_Z_ON_CHAIN).toBeGreaterThan(EDGE_Z_DIMMED);
});

const node = (id: string, o?: Partial<CompositionGraphNode>): CompositionGraphNode => ({
  id, displayName: id, packageName: null, filePath: `src/${id}.tsx`,
  scope: "local", deprecated: false, occurrenceCount: 1, ...o,
});
const graph = (nodes: CompositionGraphNode[], edges: [string, string, number?][]): CompositionGraph => ({
  nodes, edges: edges.map(([source, target, count]) => ({ source, target, count: count ?? 1 })),
});
const owners = (n: number, extra?: (i: number) => Partial<CompositionGraphNode>) =>
  Array.from({ length: n }, (_, i) => node(`o${i}`, extra?.(i)));
const withFocusEdges = (ownerNodes: CompositionGraphNode[]) =>
  buildGraphModel(graph([...ownerNodes, node("F")], ownerNodes.map(o => [o.id, "F", 1] as [string, string, number])));

const layoutOf = (model: ReturnType<typeof buildGraphModel>) =>
  computeLayout(model, "F", { pinned: null });

describe("deriveHighlight: chip lineage", () => {
  it("a more chip participates in the chain; an owner-only chain excludes it", () => {
    const m = withFocusEdges(owners(14, i => ({ occurrenceCount: 14 - i })));
    const layout = layoutOf(m);
    const viaFocus = deriveHighlight(layout, { kind: "chip", displayId: "F" });
    expect(viaFocus?.has("more:-1")).toBe(true);
    const viaOwner = deriveHighlight(layout, { kind: "chip", displayId: "o0" });
    expect(viaOwner?.has("more:-1")).toBe(false);
    expect(viaOwner?.has("F")).toBe(true);
  });

  it("returns null for a stale/unrendered display id", () => {
    const m = withFocusEdges(owners(2));
    expect(deriveHighlight(layoutOf(m), { kind: "chip", displayId: "ghost" })).toBeNull();
  });

  it("returns null for a null source", () => {
    const m = withFocusEdges(owners(2));
    expect(deriveHighlight(layoutOf(m), null)).toBeNull();
  });
});

describe("deriveHighlight: path mapping", () => {
  it("maps overflow members to the more chip", () => {
    const m = withFocusEdges(owners(14, i => ({ occurrenceCount: 14 - i })));
    const set = deriveHighlight(layoutOf(m), { kind: "path", path: ["F", "o13"] });
    expect(set?.has("more:-1")).toBe(true);
  });

  it("silently skips path ids outside the display graph", () => {
    const m = withFocusEdges(owners(2));
    const set = deriveHighlight(layoutOf(m), { kind: "path", path: ["F", "o0", "not-in-graph"] });
    expect([...(set as ReadonlySet<string>)].sort()).toEqual(["F", "o0"]);
  });
});

describe("deriveHighlight: a path reaching only the focus lights nothing", () => {
  // Lighting the focus alone would dim every other chip for a chain that isn't
  // drawn. Committing the row reveals the path.
  it("returns null when every step but the focus is undrawn", () => {
    const layout = {
      items: [{ id: "F" }] as never,
      edges: [],
      displayIdOf: new Map([["F", "F"]]),
    };
    expect(deriveHighlight(layout as never, { kind: "path", path: ["F", "X", "Y"] })).toBeNull();
  });

  it("still lights a path whose next step is drawn", () => {
    const layout = {
      items: [{ id: "F" }, { id: "P" }] as never,
      edges: [],
      displayIdOf: new Map([
        ["F", "F"],
        ["P", "P"],
      ]),
    };
    expect(deriveHighlight(layout as never, { kind: "path", path: ["F", "P"] })).toEqual(
      new Set(["F", "P"]),
    );
  });
});

describe("edgeStyle", () => {
  const edge = { source: "a", target: "b", width: 1.5 };

  it("null active set: neutral stroke, not faded, dimmed-tier zIndex", () => {
    const { style, zIndex } = edgeStyle(edge, null);
    expect(style).toEqual({ stroke: "var(--faint)", strokeWidth: 1.5, opacity: 0.8 });
    expect(zIndex).toBe(EDGE_Z_DIMMED);
  });

  it("both endpoints active: on-chain stroke, thicker width, on-chain-tier zIndex", () => {
    const { style, zIndex } = edgeStyle(edge, new Set(["a", "b"]));
    expect(style).toEqual({ stroke: "var(--foreground)", strokeWidth: 2.25, opacity: 0.8 });
    expect(zIndex).toBe(EDGE_Z_ON_CHAIN);
  });

  it("one endpoint active: not on-chain, faded", () => {
    const { style, zIndex } = edgeStyle(edge, new Set(["a"]));
    expect(style).toEqual({ stroke: "var(--faint)", strokeWidth: 1.5, opacity: 0.15 });
    expect(zIndex).toBe(EDGE_Z_DIMMED);
  });

  it("neither endpoint active but a highlight is active elsewhere: faded", () => {
    const { style, zIndex } = edgeStyle(edge, new Set(["z"]));
    expect(style).toEqual({ stroke: "var(--faint)", strokeWidth: 1.5, opacity: 0.15 });
    expect(zIndex).toBe(EDGE_Z_DIMMED);
  });
});

describe("deriveHighlight: undrawn path nodes light nothing", () => {
  it("path nodes missing from displayIdOf are skipped: no stand-in from upElementsOf", () => {
    // An undrawn intermediate lights nothing; with only the focus drawn, the
    // highlight is null.
    const layout = {
      items: [{ id: "F" }, { id: "G" }, { id: "P" }] as never,
      edges: [],
      displayIdOf: new Map([["F", "F"]]),
      upElementsOf: new Map([
        ["x1", ["P", "F"]],
        ["r0", ["G", "P", "F"]],
      ]),
    };
    const lit = deriveHighlight(layout as never, { kind: "path", path: ["F", "x1", "r0"] });
    expect(lit).toBeNull();
  });
});

describe("path highlight with an undrawn intermediate", () => {
  const layout = {
    items: [{ id: "origin" }, { id: "focus" }, { id: "standin" }] as never,
    edges: [],
    // The true intermediate `mid` is not drawn: it has no display id.
    displayIdOf: new Map([
      ["origin", "origin"],
      ["focus", "focus"],
    ]),
    // Its lane falls back to a drawn stand-in element.
    upElementsOf: new Map([["mid", ["standin"]]]),
  };

  it("lights only the drawn ends, never the stand-in", () => {
    const lit = deriveHighlight(layout, { kind: "path", path: ["focus", "mid", "origin"] });
    expect(lit).not.toBeNull();
    expect([...(lit as ReadonlySet<string>)].sort()).toEqual(["focus", "origin"]);
  });

  it("still lights every step when the whole path is drawn", () => {
    const drawn = {
      ...layout,
      displayIdOf: new Map([
        ["origin", "origin"],
        ["mid", "standin"],
        ["focus", "focus"],
      ]),
    };
    const lit = deriveHighlight(drawn, { kind: "path", path: ["focus", "mid", "origin"] });
    expect([...(lit as ReadonlySet<string>)].sort()).toEqual(["focus", "origin", "standin"]);
  });
});
