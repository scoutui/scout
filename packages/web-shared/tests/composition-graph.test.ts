import { describe, it, expect } from "vitest";
import type { Component, Occurrence } from "@scoutui/scan-format";
import { projectCompositionGraph } from "./helpers/composition-graph.js";
import type { GovernanceRecord } from "../src/dto.js";
import { artifact, component, packageExport, repoDeclaration, resolvedAt } from "./helpers/builders.js";

const renders = (rendersByCount: Record<string, number>): Partial<Component> =>
  ({ composition: { rendersByCount, renderedByCount: {}, isRootCount: 0, isLeafCount: 0 } });

const local = (name: string, over: Partial<Component> = {}): Component =>
  component(repoDeclaration("repo-a", `src/${name}.tsx`, name), over);

function calls(c: Component, count: number): Occurrence[] {
  return Array.from({ length: count }, (_, index) => resolvedAt(c, "src/App.tsx", index + 1));
}

describe("projectCompositionGraph", () => {
  it("emits one node per component, labelled from its presented identity", () => {
    const button = component(packageExport("@ui/lib", "Button"));
    const panel = local("Panel", renders({ [button.id]: 2 }));
    const g = projectCompositionGraph(artifact({ components: [button, panel], occurrences: [...calls(button, 2), ...calls(panel, 1)] }));
    expect(g.nodes).toEqual([
      { id: button.id, displayName: "Button", packageName: "@ui/lib", filePath: null, scope: "external", deprecated: false, occurrenceCount: 2 },
      { id: panel.id, displayName: "Panel", packageName: null, filePath: "src/Panel.tsx", scope: "local", deprecated: false, occurrenceCount: 1 },
    ]);
    expect(g.edges).toEqual([{ source: panel.id, target: button.id, count: 2 }]);
  });

  it("drops a component's edge to itself", () => {
    const tree = local("Tree");
    tree.composition.rendersByCount[tree.id] = 4;
    const g = projectCompositionGraph(artifact({ components: [tree], occurrences: [] }));
    expect(g.edges).toHaveLength(0);
    expect(g.nodes.map(n => n.id)).toEqual([tree.id]);
  });

  it("ignores rendersByCount targets absent from the artifact", () => {
    const g = projectCompositionGraph(artifact({ components: [local("A", renders({ ghost: 9 }))], occurrences: [] }));
    expect(g.edges).toHaveLength(0);
  });

  it("stamps deprecated from governance for externals; a local of the same name stays active", () => {
    const gov: GovernanceRecord[] = [{
      id: "g1", grain: "component", targetPackage: "@ui/lib", targetExport: "X",
      disposition: { kind: "retired", reason: "legacy" }, createdAt: "t", updatedAt: "t",
    }];
    const external = component(packageExport("@ui/lib", "X"));
    const sameName = local("X");
    const g = projectCompositionGraph(artifact({ components: [external, sameName], occurrences: [] }), gov);
    expect(g.nodes.find(n => n.id === external.id)?.deprecated).toBe(true);
    expect(g.nodes.find(n => n.id === sameName.id)?.deprecated).toBe(false);
  });

  it("keeps edgeless nodes and sorts nodes by occurrence desc, edges by count desc", () => {
    const lonely = local("Lonely");
    const mid = local("Mid");
    const big = local("Big", renders({ [lonely.id]: 1, [mid.id]: 7 }));
    const g = projectCompositionGraph(artifact({ components: [lonely, big, mid], occurrences: [...calls(lonely, 1), ...calls(big, 9), ...calls(mid, 5)] }));
    expect(g.nodes.map(n => n.id)).toEqual([big.id, mid.id, lonely.id]);
    expect(g.edges.map(e => e.count)).toEqual([7, 1]);
  });
});
