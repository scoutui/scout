import type { CSSProperties } from "react";
import type { CanvasLayout, LayoutEdge } from "./graph-layout";

export type EdgeTip = { tip: string };

/**
 * Edge tooltip text keyed by edge id: each edge's count of direct uses.
 */
export function buildEdgeTips(layout: Pick<CanvasLayout, "edges">): Map<string, EdgeTip> {
  const tips = new Map<string, EdgeTip>();
  for (const e of layout.edges) {
    tips.set(e.id, {
      tip:
        e.count === 1
          ? "1 direct use."
          : `${e.count.toLocaleString()} direct uses.`,
    });
  }
  return tips;
}

/** @xyflow/react renders every edge and every node as positioned children of
 *  `.react-flow__viewport` with no stacking context between them, so edge and
 *  node zIndex compete directly. Nodes here are never selectable, so they stay
 *  at zIndex 0. Both edge tiers must stay negative, or a highlighted edge
 *  paints over the chips. */
export const EDGE_Z_ON_CHAIN = -1;
export const EDGE_Z_DIMMED = -2;

/** Edge stroke, width, opacity and zIndex for the active highlight. */
export function edgeStyle(
  edge: Pick<LayoutEdge, "source" | "target" | "width">,
  active: ReadonlySet<string> | null,
): { style: CSSProperties; zIndex: number } {
  const onChain = Boolean(active?.has(edge.source) && active.has(edge.target));
  const faded = active !== null && !onChain;
  return {
    style: {
      stroke: onChain ? "var(--foreground)" : "var(--faint)",
      strokeWidth: onChain ? edge.width + 0.75 : edge.width,
      opacity: faded ? 0.15 : 0.8,
    },
    zIndex: onChain ? EDGE_Z_ON_CHAIN : EDGE_Z_DIMMED,
  };
}

/** What the user is pointing at. "chip" is a canvas display id (chip, group or
 *  "more"); "path" is an ordered list of real node ids (focus → endpoint) from
 *  a rail or member-panel row, mapped through the display graph. */
export type HighlightSource =
  | { kind: "chip"; displayId: string }
  | { kind: "path"; path: string[] };

/** Ancestors and descendants of `id` over the aggregated display edges. Two
 *  directional walks, not one undirected one, so hovering a mid-tree chip
 *  doesn't light other parents of its children. */
export function chainOnDisplay(
  displayEdges: Iterable<{ source: string; target: string }>,
  id: string,
): Set<string> {
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const { source, target } of displayEdges) {
    const parents = up.get(target);
    if (parents) parents.push(source);
    else up.set(target, [source]);
    const children = down.get(source);
    if (children) children.push(target);
    else down.set(source, [target]);
  }
  const chain = new Set<string>([id]);
  for (const next of [up, down]) {
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      for (const n of next.get(cur) ?? []) {
        if (!chain.has(n)) {
          chain.add(n);
          queue.push(n);
        }
      }
    }
  }
  return chain;
}

/** The display ids a highlight source lights on the current scene, or null for
 *  no highlight. Never changes geometry. */
export function deriveHighlight(
  layout: Pick<CanvasLayout, "items" | "edges" | "displayIdOf">,
  source: HighlightSource | null,
): ReadonlySet<string> | null {
  if (source === null) return null;
  if (source.kind === "chip") {
    if (!layout.items.some((i) => i.id === source.displayId)) return null;
    return chainOnDisplay(layout.edges, source.displayId);
  }
  const ids = new Set<string>();
  for (const nodeId of source.path) {
    const displayId = layout.displayIdOf.get(nodeId);
    if (displayId !== undefined) {
      ids.add(displayId);
    }
    // An undrawn step is skipped: the drawn steps still light, and pinning the
    // row reveals the rest.
  }
  if (ids.size === 0) return null;
  // A path whose only drawn step is the focus lights nothing, rather than
  // dimming every other chip to show nothing. `path[0]` is always the focus.
  const focusDisplayId = layout.displayIdOf.get(source.path[0] as string);
  if (ids.size === 1 && focusDisplayId !== undefined && ids.has(focusDisplayId)) return null;
  return ids;
}
