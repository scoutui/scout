import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateArtifact } from "@scoutui/scan-format";
import { compositionNeighbourhood, type CompositionGraph } from "@scoutui/web-shared";
import { buildGraphModel, closureOf, pathBetween } from "@/components/component-detail/composition/graph-model";
import { computeLayout } from "@/components/component-detail/composition/graph-layout";
import { projectCompositionGraph } from "../../../../packages/web-shared/tests/helpers/composition-graph.ts";

const baselines = new URL("../../../../packages/cli/tests/integration/__baselines__/current/", import.meta.url);

function graphOf(file: string): CompositionGraph {
  const validated = validateArtifact(JSON.parse(readFileSync(new URL(file, baselines), "utf8")));
  if (!validated.ok) throw new Error(`${file} is not a valid scan: ${validated.reason}`);
  return projectCompositionGraph(validated.artifact);
}

/** What the composition tab reads for one focus: its direct neighbours, both
 *  rail lists, each row's path and the canvas, unpinned and pinned to each row. */
function tabView(graph: CompositionGraph, focusId: string) {
  const model = buildGraphModel(graph);
  const rows = (["up", "down"] as const).flatMap(dir => closureOf(model, focusId, dir).map(row => ({ dir, row })));
  return {
    parents: model.parentsOf.get(focusId),
    children: model.childrenOf.get(focusId),
    rows,
    layout: computeLayout(model, focusId, { pinned: null }),
    pinned: rows.map(({ dir, row }) => {
      const path = pathBetween(model, focusId, row.node.id, dir === "up" ? model.parentsOf : model.childrenOf);
      const pinned = path?.map((id, i) => ({ id, level: dir === "up" ? -i : i })) ?? null;
      return { path, layout: computeLayout(model, focusId, { pinned }) };
    }),
  };
}

const files = readdirSync(baselines).filter(file => file.endsWith(".json"));

describe("compositionNeighbourhood", () => {
  it.each(files)("%s: every component's tab reads the same from its neighbourhood as from the whole graph", file => {
    const graph = graphOf(file);
    for (const { id } of graph.nodes) {
      expect(tabView(compositionNeighbourhood(graph, id), id), id).toEqual(tabView(graph, id));
    }
  });

  it("walks past direct neighbours in both directions on the baselines", () => {
    const deepest = { up: 0, down: 0 };
    for (const file of files) {
      const graph = graphOf(file);
      const model = buildGraphModel(graph);
      for (const { id } of graph.nodes) {
        for (const dir of ["up", "down"] as const) {
          for (const { hops } of closureOf(model, id, dir)) deepest[dir] = Math.max(deepest[dir], hops);
        }
      }
    }
    expect(deepest.up).toBeGreaterThanOrEqual(2);
    expect(deepest.down).toBeGreaterThanOrEqual(2);
  });

  it("is empty for a component the graph doesn't hold", () => {
    const graph = graphOf("react-shapes.json");
    expect(compositionNeighbourhood(graph, "absent")).toEqual({ nodes: [], edges: [] });
  });
});
