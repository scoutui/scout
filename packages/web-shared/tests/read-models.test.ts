import { describe, expect, it } from "vitest";
import { componentKey } from "@scoutui/scan-format";
import type { GovernanceRecord } from "../src/dto.js";
import {
  createProjectionContext, deriveComponentDetailHead, deriveFactScan, deriveReadModelRows, reduceComponentRows, reduceComponentsAcrossScans,
  reducePackageDetail, reducePackagesAcrossScans, reduceRepoSummary,
} from "../src/index.js";
import { projectCompositionGraph } from "./helpers/composition-graph.js";
import { genericArtifacts } from "./helpers/fixtures.ts";
import { artifact, component, packageExport, received, repoDeclaration, resolvedAt, unresolvedAt } from "./helpers/builders.js";

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

  it.each([
    { retired: "Button", inUse: 1 },
    { retired: "Tree", inUse: 0 },
  ])("counts deprecated $retired as in use on the repo and package pages only when it has uses, and marks its row deprecated", ({ retired, inUse }) => {
    const button = component(packageExport("@example/ui", "Button"));
    const tree = component(packageExport("@example/ui", "Tree"));
    const scan = artifact({ components: [button, tree], occurrences: [resolvedAt(button, "src/App.tsx")] });
    const facts = [{ ...deriveFactScan(scan), meta: received(scan).meta }];
    const t = "2026-01-01T00:00:00Z";
    const governance: GovernanceRecord[] = [{
      id: "retire", grain: "component", targetPackage: "@example/ui", targetExport: retired,
      disposition: { kind: "retired", reason: "replaced" }, createdAt: t, updatedAt: t,
    }];
    const [fact] = facts;
    if (!fact) throw new Error("Missing fact");
    expect(reduceComponentRows(fact, "", governance).filter(row => row.deprecated).map(row => row.displayName)).toEqual([retired]);
    expect(reduceRepoSummary(fact, { scanCount: 1, delta: null }, governance).deprecatedCount).toBe(inUse);
    expect(reducePackagesAcrossScans(facts, governance).find(row => row.packageName === "@example/ui")?.deprecatedCount).toBe(inUse);
    expect(reducePackageDetail(facts, "@example/ui", governance)?.deprecatedCount).toBe(inUse);
  });

  it("counts a deprecated component used in several repos once in a package's totals, as its component rows do", () => {
    const button = component(packageExport("@example/ui", "Button"));
    const card = component(packageExport("@example/ui", "Card"));
    const facts = ["repo-a", "repo-b", "repo-c"].map(repoId => {
      const scan = artifact({ scanId: `scan-${repoId}`, repoId, components: [button, card], occurrences: [resolvedAt(button, "src/App.tsx"), resolvedAt(card, "src/App.tsx", 2)] });
      return { ...deriveFactScan(scan), meta: received(scan).meta };
    });
    const t = "2026-01-01T00:00:00Z";
    const governance: GovernanceRecord[] = [{
      id: "retire-button", grain: "component", targetPackage: "@example/ui", targetExport: "Button",
      disposition: { kind: "retired", reason: "replaced" }, createdAt: t, updatedAt: t,
    }];
    const detail = reducePackageDetail(facts, "@example/ui", governance);
    expect(detail?.components.filter(row => row.deprecated).map(row => row.componentId)).toEqual([button.id]);
    expect(detail?.deprecatedCount).toBe(1);
    expect(reducePackagesAcrossScans(facts, governance).find(row => row.packageName === "@example/ui")?.deprecatedCount).toBe(1);
  });

  it("gives components that share a package and a name, in any repo, their entry point to tell them apart", () => {
    const button = component(packageExport("@example/ui", "Button"));
    const buttonEntry = component(packageExport("@example/ui", "Button", "dist/button/index"));
    const card = component(packageExport("@example/ui", "Card"));
    const facts = [
      artifact({ scanId: "scan-a", repoId: "repo-a", components: [button, card], occurrences: [resolvedAt(button, "src/App.tsx"), resolvedAt(card, "src/App.tsx", 2)] }),
      artifact({ scanId: "scan-b", repoId: "repo-b", components: [buttonEntry], occurrences: [resolvedAt(buttonEntry, "src/App.tsx")] }),
    ].map(scan => ({ ...deriveFactScan(scan), meta: received(scan).meta }));
    const disambiguators = (rows: { componentId: string; disambiguator: string | null }[]) =>
      Object.fromEntries(rows.map(row => [row.componentId, row.disambiguator]));
    const expected = { [button.id]: "", [buttonEntry.id]: "dist/button/index", [card.id]: null };
    expect(disambiguators(reducePackageDetail(facts, "@example/ui")?.components ?? [])).toEqual(expected);
    expect(disambiguators(reduceComponentsAcrossScans(facts))).toEqual(expected);
  });
});
