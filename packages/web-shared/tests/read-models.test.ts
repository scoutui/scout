import { describe, expect, it } from "vitest";
import { componentKey } from "@scoutui/scan-format";
import { createProjectionContext, deriveComponentDetailHead, deriveFactScan, deriveReadModelRows } from "../src/index.js";
import { projectCompositionGraph } from "./helpers/composition-graph.js";
import { genericArtifacts } from "./helpers/fixtures.ts";
import { artifact, component, packageExport, repoDeclaration, resolvedAt, unresolvedAt } from "./helpers/builders.js";

describe("immutable read models", () => {
  it("projects resolved call sites only, and unresolved ones leave component counts unchanged", () => {
    const button = component(packageExport("@example/ui", "Button"));
    const call = resolvedAt(button, "src/App.tsx", 4, { credit: { kind: "argument", callee: "render", index: 0 }, trace: [{ kind: "import", specifier: "@example/ui", name: "Button" }] });
    const scan = artifact({
      components: [button],
      occurrences: [call, unresolvedAt({ kind: "module-not-found" }, "src/Missing.tsx"), unresolvedAt({ kind: "unbound-name", name: "Card" }, "src/Other.tsx", 2)],
    });
    const rows = [...deriveReadModelRows(scan, createProjectionContext(scan))];
    expect(rows.flatMap(row => row.kind === "occurrence" ? [row] : [])).toEqual([{
      kind: "occurrence", scanId: scan.meta.scanId, ordinal: 0, componentId: button.id,
      occurrence: { occurrenceId: call.occurrenceId, filePath: "src/App.tsx", line: 4, column: 1, credit: call.credit, trace: call.trace, props: [], events: [] },
    }]);
    expect(rows.flatMap(row => row.kind === "detail" ? [row.head.summary.footprint] : [])).toEqual([{ callCount: 1, fileCount: 1, rendersCount: 0, renderedByCount: 0 }]);
    expect(rows.flatMap(row => row.kind === "component" ? [row.fact.stats] : [])).toEqual([{ occurrenceCount: 1, fileCount: 1 }]);
    expect(rows.flatMap(row => row.kind === "graph-node" ? [row.node.occurrenceCount] : [])).toEqual([1]);
  });

  it("lists a repository declaration's workspace package as its identity package", () => {
    const panel = component(repoDeclaration("repo-a", "packages/app-kit/src/panel.tsx", "Panel"), { owningPackage: "@example/app-kit" });
    const scan = artifact({ components: [panel], occurrences: [] });
    expect(deriveFactScan(scan).components[0]?.packages).toEqual([{ packageName: "@example/app-kit", versions: [] }]);
  });

  it("derives heads from indexed statistics without revisiting occurrences", () => {
    const scan = genericArtifacts()[0];
    if (!scan) throw new Error("Missing fixture");
    const context = createProjectionContext(scan);
    Object.defineProperty(scan, "occurrences", { get() { throw new Error("Occurrences revisited"); } });
    for (const property of ["occurrences", "occurrencesByComponent"]) {
      Object.defineProperty(context, property, { get() { throw new Error(`${property} revisited`); } });
    }
    const detail = deriveComponentDetailHead(context, componentKey(packageExport("@sample/core", "Button")));
    expect(detail?.summary.footprint).toEqual({ callCount: 1, fileCount: 1, rendersCount: 0, renderedByCount: 1 });
  });

  it.each(["graph", "facts"] as const)("derives %s without reading occurrences", projection => {
    const scan = genericArtifacts()[0];
    if (!scan) throw new Error("Missing fixture");
    Object.defineProperty(scan, "occurrences", { get() { throw new Error("Occurrences accessed"); } });
    if (projection === "graph") expect(projectCompositionGraph(scan).nodes).toHaveLength(9);
    if (projection === "facts") expect(deriveFactScan(scan).components).toHaveLength(9);
  });
});
