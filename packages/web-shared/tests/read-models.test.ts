import { describe, expect, it } from "vitest";
import { componentKey } from "@scoutui/scan-format";
import type { GovernanceRecord } from "../src/dto.js";
import {
  createProjectionContext, deriveApiUsageCounts, deriveComponentDetailHead, deriveFactScan, deriveReadModelRows, reduceComponentRows, reduceComponentsAcrossScans,
  reduceCrossRepoComponent, reducePackageDetail, reducePackagesAcrossScans, reduceRepoSummary,
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
    expect(rows.flatMap(row => row.kind === "detail" ? [row.head.summary.footprint] : [])).toEqual([{ callCount: 1, fileCount: 1, rendersCount: 0, renderedByCount: 0, unseenCount: 1 }]);
    expect(rows.flatMap(row => row.kind === "component" ? [row.fact.stats] : [])).toEqual([{ occurrenceCount: 1, fileCount: 1 }]);
    expect(rows.flatMap(row => row.kind === "graph-node" ? [row.node.occurrenceCount] : [])).toEqual([1]);
  });

  it("lists a value set's values in one order on a usage row and in the component's totals", () => {
    const button = component(packageExport("@example/ui", "Button"), {
      props: { size: { values: [{ provenance: "written", valueSet: ["small", "medium"], count: 1 }], dynamic: 0, omitted: 0 } },
    });
    const scan = artifact({ components: [button], occurrences: [resolvedAt(button, "src/App.tsx", 1, { props: { size: { tier: "written", valueSet: ["small", "medium"] } } })] });
    const rows = [...deriveReadModelRows(scan, createProjectionContext(scan))];
    expect({
      row: rows.flatMap(row => row.kind === "occurrence" ? row.occurrence.props : []),
      totals: rows.flatMap(row => row.kind === "detail" ? row.head.props.flatMap(p => p.written) : []),
    }).toEqual({ row: [{ kind: "literal", name: "size", value: "medium | small" }], totals: [{ value: "medium | small", count: 1 }] });
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
    expect(detail?.summary.footprint).toEqual({ callCount: 1, fileCount: 1, rendersCount: 0, renderedByCount: 1, unseenCount: 0 });
  });

  it("derives the graph without reading occurrences", () => {
    const scan = genericArtifacts()[0];
    if (!scan) throw new Error("Missing fixture");
    Object.defineProperty(scan, "occurrences", { get() { throw new Error("Occurrences accessed"); } });
    expect(projectCompositionGraph(scan).nodes).toHaveLength(9);
  });

  it("derives facts from indexed statistics without revisiting occurrences", () => {
    const scan = genericArtifacts()[0];
    if (!scan) throw new Error("Missing fixture");
    const context = createProjectionContext(scan);
    Object.defineProperty(scan, "occurrences", { get() { throw new Error("Occurrences revisited"); } });
    for (const property of ["occurrences", "occurrencesByComponent"]) {
      Object.defineProperty(context, property, { get() { throw new Error(`${property} revisited`); } });
    }
    expect(deriveFactScan(scan, context).components).toHaveLength(9);
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
    expect(reduceComponentRows(fact, "", governance).map(row => [row.displayName, row.migration])).toEqual([
      ["Button", retired === "Button" ? { status: { status: "retired", reason: "replaced" }, recordId: "retire" } : undefined],
      ["Tree", retired === "Tree" ? { status: { status: "retired", reason: "replaced" }, recordId: "retire" } : undefined],
    ]);
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

  it("ranges a package's and a component's versions in SemVer order, not text order", () => {
    const facts = ["1.5.0", "1.14.0", "1.10.0"].map(version => {
      const button = component(packageExport("@example/ui", "Button"), { version });
      const scan = artifact({ scanId: `scan-${version}`, repoId: `repo-${version}`, components: [button], occurrences: [resolvedAt(button, "src/App.tsx")] });
      return { ...deriveFactScan(scan), meta: received(scan).meta };
    });
    const range = { oldest: "1.5.0", newest: "1.14.0" };
    expect(reducePackagesAcrossScans(facts)[0]?.versionRange).toEqual(range);
    expect(reducePackageDetail(facts, "@example/ui")?.versionRange).toEqual(range);
    expect(reduceCrossRepoComponent(facts, componentKey(packageExport("@example/ui", "Button")))?.versionRange).toEqual(range);
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

describe("declared-prop usage: shared by the component fact and the detail head's summary", () => {
  it("counts a declared prop as never used only when it's absent from props entirely, not merely unwritten", () => {
    const panel = component(repoDeclaration("repo-a", "src/Panel.tsx", "Panel"), {
      declared: { props: { size: {}, tone: {}, label: {} }, hasRest: false },
      props: {
        size: { values: [], dynamic: 1, omitted: 0 }, // declared, used (dynamic counts as used)
        extra: { values: [], dynamic: 0, omitted: 1 }, // not declared: undeclared
      },
    });
    expect(deriveApiUsageCounts(panel)).toEqual({ declaredCount: 3, usedCount: 1, neverUsedCount: 2, undeclaredCount: 1 });
  });

  it("is null for a component with no declared API, even one with props", () => {
    const button = component(packageExport("@example/ui", "Button"), { props: { onClick: { values: [], dynamic: 1, omitted: 0 } } });
    expect(deriveApiUsageCounts(button)).toBeNull();
  });

  it("counts zero never-used when every declared prop appears, whether or not the component also takes a rest/index-signature", () => {
    for (const hasRest of [false, true]) {
      const panel = component(repoDeclaration("repo-a", "src/Panel.tsx", "Panel"), {
        declared: { props: { size: {} }, hasRest },
        props: { size: { values: [], dynamic: 0, omitted: 1 } },
      });
      expect(deriveApiUsageCounts(panel)).toMatchObject({ declaredCount: 1, neverUsedCount: 0 });
    }
  });

  it("promotes the same declared/never-used counts onto ComponentFact that the detail head's summary carries, absent from both without a declared API", () => {
    const panel = component(repoDeclaration("repo-a", "src/Panel.tsx", "Panel"), {
      declared: { props: { size: {}, tone: {} }, hasRest: true },
      props: { size: { values: [], dynamic: 1, omitted: 0 } },
    });
    const button = component(packageExport("@example/ui", "Button"), { props: { onClick: { values: [], dynamic: 1, omitted: 0 } } });
    const scan = artifact({ components: [panel, button], occurrences: [] });
    const context = createProjectionContext(scan);
    const facts = deriveFactScan(scan, context).components;
    expect(facts.find(c => c.id === panel.id)?.apiUsage).toEqual({ declaredCount: 2, neverUsedCount: 1 });
    expect(facts.find(c => c.id === button.id)?.apiUsage).toBeUndefined();
    expect(deriveComponentDetailHead(context, panel.id)?.summary.apiUsage).toEqual({ declaredCount: 2, usedCount: 1, neverUsedCount: 1, undeclaredCount: 0 });
  });

  it("carries a row's declared-prop counts through reduceComponentRows unchanged, since one repo's one scan has nothing to aggregate", () => {
    const panel = component(repoDeclaration("repo-a", "src/Panel.tsx", "Panel"), {
      declared: { props: { size: {}, tone: {} }, hasRest: false },
      props: { size: { values: [], dynamic: 1, omitted: 0 } },
    });
    const button = component(packageExport("@example/ui", "Button"));
    const scan = artifact({ components: [panel, button], occurrences: [] });
    const fact = { ...deriveFactScan(scan), meta: received(scan).meta };
    const rows = reduceComponentRows(fact, "");
    expect(rows.find(r => r.componentId === panel.id)?.apiUsage).toEqual({ declaredCount: 2, neverUsedCount: 1 });
    expect(rows.find(r => r.componentId === button.id)?.apiUsage).toBeUndefined();
  });
});

describe("declared-prop verdicts: unused only when every use is fully seen and the prop declares no default", () => {
  const PANEL = repoDeclaration("repo-a", "src/Panel.tsx", "Panel");
  /** A Panel whose uses are `uses`, declaring `declared` props, its `props` rolled up from the uses. */
  function project(declared: Record<string, object>, uses: Partial<Parameters<typeof resolvedAt>[3]>[], extra: { components?: ReturnType<typeof component>[]; owningPackage?: string } = {}) {
    const named = new Set(uses.flatMap(u => Object.keys(u?.props ?? {})));
    const panel = component(PANEL, {
      declared: { props: declared, hasRest: false },
      props: Object.fromEntries([...named].map(name => [name, { values: [], dynamic: 1, omitted: uses.length - 1 }])),
      ...(extra.owningPackage ? { owningPackage: extra.owningPackage } : {}),
    });
    const scan = artifact({ components: [panel, ...(extra.components ?? [])], occurrences: uses.map((u, i) => resolvedAt(panel, "src/App.tsx", i + 1, u)) });
    const context = createProjectionContext(scan);
    const head = deriveComponentDetailHead(context, panel.id);
    const verdicts = Object.fromEntries((head?.props ?? []).flatMap(p => (p.verdict ? [[p.name, p.verdict]] : [])));
    return { head, verdicts, fact: deriveFactScan(scan, context).components.find(c => c.id === panel.id) };
  }
  const RENDER = {};
  const SPREAD = { props: { "...rest": { tier: "dynamic" as const } } };

  it.each([
    ["no default", { hasDefault: false }, "unused"],
    ["a literal default", { required: false, default: "md" }, undefined],
    ["a non-literal default", { required: false, hasDefault: true }, undefined],
    ["a default Scout didn't read", {}, "possibly-unused"],
  ])("gives a never-passed prop with %s, on fully seen uses, the verdict %s", (_case, size, verdict) => {
    expect(project({ size }, [RENDER, RENDER]).verdicts.size).toBe(verdict);
  });

  it.each([
    ["spreads props", SPREAD],
    ["is passed as an argument", { credit: { kind: "argument" as const, callee: "useModal", index: 0 } }],
    ["goes through a wrapper that may add props", { trace: [{ kind: "hoc" as const, callee: "withTheme", mayAddProps: true as const }] }],
    ["goes through a wrapper with no mark", { trace: [{ kind: "hoc" as const, callee: "memo" }] }],
  ])("makes a never-passed prop with no default possibly unused when one use %s", (_case, use) => {
    expect(project({ size: { hasDefault: false } }, [RENDER, use]).verdicts.size).toBe("possibly-unused");
  });

  it("gives styling props, test ids and attributes no verdict, as Top props leaves them out", () => {
    const none = { hasDefault: false };
    const { verdicts, head } = project({ className: none, style: none, testId: none, "data-state": none, size: none }, [RENDER]);
    expect({ verdicts, counts: head?.summary.apiUsage }).toMatchObject({ verdicts: { size: "unused" }, counts: { unusedCount: 1, possiblyUnusedCount: 0 } });
  });

  it("gives a prop a use passes no verdict, whatever its default", () => {
    expect(project({ size: { hasDefault: false } }, [{ props: { size: { tier: "written", value: "sm" } } }, SPREAD]).verdicts).toEqual({});
  });

  it("gives no verdicts to a component with no uses", () => {
    const { verdicts, head, fact } = project({ size: { hasDefault: false } }, []);
    expect({ verdicts, apiUsage: head?.summary.apiUsage, fact: fact?.apiUsage }).toEqual({
      verdicts: {},
      apiUsage: { declaredCount: 1, usedCount: 0, neverUsedCount: 1, undeclaredCount: 0 },
      fact: { declaredCount: 1, neverUsedCount: 1 },
    });
  });

  it("makes never-passed props possibly unused when a package component in the scan has the declaration's package and export", () => {
    const shared = component(packageExport("@example/shared", "Panel"));
    const other = component(packageExport("@example/shared", "Card"));
    const declared = { size: { hasDefault: false } };
    expect(project(declared, [RENDER], { owningPackage: "@example/shared", components: [shared] }).verdicts.size).toBe("possibly-unused");
    expect(project(declared, [RENDER], { owningPackage: "@example/shared", components: [other] }).verdicts.size).toBe("unused");
  });

  it("counts each verdict on the component fact and the head, and the uses Scout doesn't fully see", () => {
    const { head, fact } = project({ size: { hasDefault: false }, tone: {}, label: { default: "Go" } }, [RENDER, RENDER]);
    expect({ fact: fact?.apiUsage, apiUsage: head?.summary.apiUsage, unseen: head?.summary.footprint.unseenCount }).toEqual({
      fact: { declaredCount: 3, neverUsedCount: 3, unusedCount: 1, possiblyUnusedCount: 1 },
      apiUsage: { declaredCount: 3, usedCount: 0, neverUsedCount: 3, undeclaredCount: 0, unusedCount: 1, possiblyUnusedCount: 1 },
      unseen: 0,
    });
    expect(project({ size: { hasDefault: false } }, [RENDER, SPREAD]).head?.summary.footprint.unseenCount).toBe(1);
  });

  it("counts the fully seen uses that leave out a prop with a known default", () => {
    const { head } = project(
      { size: { default: "md" }, icon: { hasDefault: true, defaultRef: "defaultIcon" }, tone: { hasDefault: false } },
      [{ props: { size: { tier: "written", value: "sm" } } }, RENDER, RENDER, SPREAD],
    );
    const byName = new Map(head?.props.map(p => [p.name, p]));
    expect({
      size: [byName.get("size")?.defaultCount, byName.get("size")?.declared],
      icon: [byName.get("icon")?.defaultCount, byName.get("icon")?.declared],
      tone: [byName.get("tone")?.defaultCount, byName.get("tone")?.declared],
    }).toEqual({
      size: [2, { type: null, required: null, default: "md", hasDefault: true, defaultRef: null }],
      icon: [3, { type: null, required: null, default: null, hasDefault: true, defaultRef: "defaultIcon" }],
      tone: [undefined, { type: null, required: null, default: null, hasDefault: false, defaultRef: null }],
    });
  });

  it("names the package component whose uses may pass the declaration's props", () => {
    const shared = component(packageExport("@example/shared", "Panel"));
    expect(project({ size: { hasDefault: false } }, [RENDER], { owningPackage: "@example/shared", components: [shared] }).head?.packageComponentId).toBe(shared.id);
  });
});
