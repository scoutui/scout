import type { CompositionGraph, CompositionGraphNode } from "@scoutui/web-shared";
import { buildGraphModel, type GraphModel } from "@/components/component-detail/composition/graph-model";

export const node = (id: string, o?: Partial<CompositionGraphNode>): CompositionGraphNode => ({
  id, displayName: id, packageName: null, filePath: `src/${id}.tsx`,
  scope: "local", deprecated: false, occurrenceCount: 1, ...o,
});

export const graph = (
  nodes: CompositionGraphNode[],
  edges: [string, string, number?][],
): CompositionGraph => ({
  nodes,
  edges: edges.map(([source, target, count]) => ({ source, target, count: count ?? 1 })),
});

export const model = (g: CompositionGraph): GraphModel => buildGraphModel(g);

/** Structured (Tooltip-shaped): 12 roots; mid-components A (renders r0..r5's
 *  paths into F) and B (r6..r8); r9..r11 reach F through private 2-hop chains.
 *  F's direct parents are A, B, c9, c10 and c11. */
export function structuredFixture(): { graph: CompositionGraph; focusId: string } {
  const nodes = [
    node("F"), node("A"), node("B"),
    ...Array.from({ length: 12 }, (_, i) => node(`r${i}`)),
    node("c9"), node("c10"), node("c11"), // private chain steps for r9..r11
  ];
  const edges: [string, string, number?][] = [
    ["A", "F", 6], ["B", "F", 3],
    ...Array.from({ length: 6 }, (_, i) => [`r${i}`, "A", 1] as [string, string, number]),
    ...[6, 7, 8].map((i) => [`r${i}`, "B", 1] as [string, string, number]),
    ...[9, 10, 11].flatMap((i) => [
      [`r${i}`, `c${i}`, 1] as [string, string, number],
      [`c${i}`, "F", 1] as [string, string, number],
    ]),
  ];
  return { graph: graph(nodes, edges), focusId: "F" };
}

/** Flat (Button-shaped): 8 roots, each with its own 2-hop chain to F, plus S
 *  on r0..r1's path. F has 9 direct parents (S, m0..m7). */
export function flatFixture(): { graph: CompositionGraph; focusId: string } {
  const nodes = [
    node("F"), node("S"),
    ...Array.from({ length: 8 }, (_, i) => node(`r${i}`)),
    ...Array.from({ length: 8 }, (_, i) => node(`m${i}`)),
  ];
  const edges: [string, string, number?][] = [
    ["S", "F", 2],
    ...[0, 1].map((i) => [`r${i}`, "S", 1] as [string, string, number]),
    ...Array.from({ length: 8 }, (_, i) => [`r${i}`, `m${i}`, 1] as [string, string, number]),
    ...Array.from({ length: 8 }, (_, i) => [`m${i}`, "F", 1] as [string, string, number]),
  ];
  return { graph: graph(nodes, edges), focusId: "F" };
}

/** KBarRoot-shaped: 7 roots reach F through shell P; 3 of them (r0..r2) also
 *  render F directly, so they are both direct parents and two-hop ancestors. */
export function dualRouteFixture(): { graph: CompositionGraph; focusId: string } {
  const nodes = [node("F"), node("P"), ...Array.from({ length: 7 }, (_, i) => node(`r${i}`))];
  const edges: [string, string, number?][] = [
    ["P", "F", 7],
    ...Array.from({ length: 7 }, (_, i) => [`r${i}`, "P", 1] as [string, string, number]),
    ...[0, 1, 2].map((i) => [`r${i}`, "F", 1] as [string, string, number]),
  ];
  return { graph: graph(nodes, edges), focusId: "F" };
}

/** Tiny (WebhookForm-shaped): 3 roots, all direct. */
export function tinyFixture(): { graph: CompositionGraph; focusId: string } {
  const nodes = [node("F"), node("r0"), node("r1"), node("r2")];
  const edges: [string, string, number?][] = [
    ["r0", "F", 1], ["r1", "F", 2], ["r2", "F", 1],
  ];
  return { graph: graph(nodes, edges), focusId: "F" };
}

/** Downward-shaped (child-side only, no owners): F renders A and B; A renders
 *  C; C renders D. D sits at hop 3, never drawn at rest (only ±1 is), so it is
 *  a real rail row with no `displayIdOf` entry, and the drawn prefix of its
 *  path must still be connected. */
export function downwardFixture(): { graph: CompositionGraph; focusId: string } {
  const nodes = [node("F"), node("A"), node("B"), node("C"), node("D")];
  const edges: [string, string, number?][] = [
    ["F", "A", 1], ["F", "B", 1], ["A", "C", 1], ["C", "D", 1],
  ];
  return { graph: graph(nodes, edges), focusId: "F" };
}
