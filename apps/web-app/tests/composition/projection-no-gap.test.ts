import { describe, it, expect } from "vitest";
import { buildGraphModel, closureOf, pathBetween } from "@/components/component-detail/composition/graph-model";
import { computeLayout, type CanvasLayout } from "@/components/component-detail/composition/graph-layout";
import { deriveHighlight } from "@/components/component-detail/composition/graph-highlight";
import { structuredFixture, flatFixture, dualRouteFixture, tinyFixture, downwardFixture } from "./graph-fixtures";

/** Lit set is gap-free when it forms one connected component over drawn edges
 *  (an edge connects two lit elements when both endpoints are lit). */
function isConnected(lit: ReadonlySet<string>, layout: CanvasLayout): boolean {
  if (lit.size <= 1) return true;
  const adj = new Map<string, string[]>();
  for (const e of layout.edges) {
    if (lit.has(e.source) && lit.has(e.target)) {
      adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
      adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
    }
  }
  const [start] = lit;
  const seen = new Set([start]);
  const queue = [start as string];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const n of adj.get(cur) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }
  return seen.size === lit.size;
}

const fixtures = {
  structured: structuredFixture(),
  flat: flatFixture(),
  dualRoute: dualRouteFixture(),
  tiny: tinyFixture(),
  downward: downwardFixture(),
};

describe("no-gap invariant", () => {
  for (const [name, fx] of Object.entries(fixtures)) {
    it(`${name}: every rail row (both directions) lights a connected set, or nothing at all`, () => {
      const model = buildGraphModel(fx.graph);
      const focusId = fx.focusId;
      const layout = computeLayout(model, focusId, { pinned: null });

      const check = (label: string, path: string[] | null) => {
        expect(path, `path to ${label}`).not.toBeNull();
        const lit = deriveHighlight(layout, { kind: "path", path: path as string[] });
        const hasDrawnNonFocusNode = (path as string[]).some(
          (id) => id !== focusId && layout.displayIdOf.has(id),
        );
        // Nothing but the focus is drawn for this row, so the hover lights
        // nothing rather than dimming every other chip for a chain that isn't
        // on screen.
        if (!hasDrawnNonFocusNode) {
          expect(lit, `lit for ${label}`).toBeNull();
          return;
        }
        expect(lit, `lit for ${label}`).not.toBeNull();
        expect(isConnected(lit as ReadonlySet<string>, layout), `${label} has a dark gap`).toBe(true);
        // A lit set of just the focus passes isConnected trivially (size <= 1),
        // so a row that lights nothing beyond the focus is caught here.
        expect(
          [...(lit as ReadonlySet<string>)].some((id) => id !== focusId),
          `${label} lights only the focus`,
        ).toBe(true);
      };

      for (const target of closureOf(model, focusId, "up").map((e) => e.node.id)) {
        check(`${name}/up/${target}`, pathBetween(model, focusId, target, model.parentsOf));
      }
      for (const target of closureOf(model, focusId, "down").map((e) => e.node.id)) {
        check(`${name}/down/${target}`, pathBetween(model, focusId, target, model.childrenOf));
      }
    });
  }

  it("committed (pinned) rows also light a fully drawn chain", () => {
    const fx = fixtures.structured;
    const model = buildGraphModel(fx.graph);
    for (const target of closureOf(model, fx.focusId, "up").map((e) => e.node.id)) {
      const path = pathBetween(model, fx.focusId, target, model.parentsOf) as string[];
      const pinned = path.map((id, i) => ({ id, level: -i }));
      const layout = computeLayout(model, fx.focusId, { pinned });
      // Pinned nodes each render as their own chip, so the pinned id set is the display set.
      const lit = new Set(pinned.map((p) => p.id));
      for (const id of lit) expect(layout.displayIdOf.get(id), `${id} drawn`).toBe(id);
      expect(isConnected(lit, layout), `pinned ${target}`).toBe(true);
    }
  });
});
