import { describe, it, expect } from "vitest";
import type { Component, TagAttribution } from "@scoutui/scan-format";
import type { Tag, GovernanceRecord } from "../src/dto.js";
import { resolveCohort, projectCohortSnapshot, projectCohortSeries, projectRepoCoverage } from "../src/cohorts.js";
import { artifact, component, packageExport, received, repoDeclaration, resolvedAt, tag } from "./helpers/builders.js";

/** One scan of `repoId` in which each component has the given number of occurrences. */
function scan(repoId: string, scannedAt: string, uses: Array<[Component, number]>) {
  return received(artifact({
    repoId,
    scanId: `${repoId}:${scannedAt}`,
    scannedAt,
    components: uses.map(([c]) => c),
    occurrences: uses.flatMap(([c, count]) => Array.from({ length: count }, (_, i) => resolvedAt(c, "src/app.tsx", i + 1))),
  }));
}

const resolvedTo = (packageName: string): TagAttribution => ({ status: "resolved", target: { kind: "package", packageName }, confidence: "observed", evidence: [] });
const unknown: TagAttribution = { status: "unknown", reason: "absent", evidence: [] };

const webTag: Tag = { id: "web", value: "web", category: "library", color: "violet", rule: { glob: ["@x/web-*"], exact: [] } };
const legacyTag: Tag = { id: "legacy", value: "legacy", category: "library", color: "berry", rule: { glob: [], exact: ["legacy-design-system"] } };

const webButton = component(packageExport("@x/web-webc", "WebButton"));
const webCard = component(packageExport("@x/web-webc", "WebCard"));
const legacyCard = component(packageExport("legacy-design-system", "Card"));
const webTab = component(tag("web-tab"), { attribution: resolvedTo("@x/web-webc") });
const panel = component(repoDeclaration("r1", "src/panel.tsx", "Panel"));
const idle = component(repoDeclaration("r1", "src/idle.tsx", "Idle"));
const shell = component(tag("app-shell"), {
  attribution: { status: "resolved", target: { kind: "repository", repoId: "r1", filePath: "src/shell.ts", exportName: "AppShell" }, confidence: "observed", evidence: [] },
});

const t1 = "2026-01-01T00:00:00Z";
const t2 = "2026-01-02T00:00:00Z";
const a = scan("r1", t1, [[webButton, 10], [webCard, 5], [legacyCard, 7], [webTab, 1], [panel, 2], [idle, 0], [shell, 3]]);

describe("resolveCohort", () => {
  it("local: repository declarations and tags this scan resolves to a repository; usedKeys holds only the used ones", () => {
    expect(resolveCohort({ kind: "local" }, a, [webTag])).toEqual({ occurrences: 5, usedKeys: new Set([panel.id, shell.id]) });
  });

  it("package: the package's exports and the tags this scan resolves to it", () => {
    expect(resolveCohort({ kind: "package", packageName: "@x/web-webc" }, a, [webTag])).toEqual({ occurrences: 16, usedKeys: new Set([webButton.id, webCard.id, webTab.id]) });
  });

  it("package: a repository declaration counts in its workspace package's cohort", () => {
    const kitPanel = component(repoDeclaration("r2", "packages/app-kit/src/panel.tsx", "Panel"), { owningPackage: "@example/app-kit" });
    const b = scan("r2", t1, [[kitPanel, 4]]);
    expect(resolveCohort({ kind: "package", packageName: "@example/app-kit" }, b, [])).toEqual({ occurrences: 4, usedKeys: new Set([kitPanel.id]) });
  });

  it("package: a tag this scan leaves unattributed is not the package's", () => {
    const b = scan("r2", t1, [[component(tag("web-tab"), { attribution: unknown }), 4]]);
    expect(resolveCohort({ kind: "package", packageName: "@x/web-webc" }, b, [])).toEqual({ occurrences: 0, usedKeys: new Set() });
  });

  it("component: matches a single component id", () => {
    expect(resolveCohort({ kind: "component", componentId: legacyCard.id }, a, [webTag])).toEqual({ occurrences: 7, usedKeys: new Set([legacyCard.id]) });
  });

  it("tag: matches every package the tag resolves to (via resolveTags)", () => {
    expect(resolveCohort({ kind: "tag", tagId: "web" }, a, [webTag])).toEqual({ occurrences: 16, usedKeys: new Set([webButton.id, webCard.id, webTab.id]) });
  });

  it("returns zero for a cohort with no matches", () => {
    expect(resolveCohort({ kind: "package", packageName: "nope" }, a, [webTag])).toEqual({ occurrences: 0, usedKeys: new Set() });
  });
});

describe("projectCohortSnapshot", () => {
  const r1 = scan("r1", t2, [[webButton, 10], [legacyCard, 7]]);
  const r1old = scan("r1", t1, [[webButton, 999]]);
  const r2 = scan("r2", t2, [[webButton, 2]]);

  it("uses only the latest scan per repo, summed across repos (count)", () => {
    const pts = projectCohortSnapshot([r1old, r1, r2], [webTag, legacyTag], [{ kind: "tag", tagId: "web" }, { kind: "tag", tagId: "legacy" }], "count");
    expect(pts.find((p) => p.cohortKey === "tag:web")?.value).toBe(12); // r1 latest (10) + r2 (2); r1old (999) ignored
    expect(pts.find((p) => p.cohortKey === "tag:legacy")?.value).toBe(7);
  });

  it("carries tag label + colour and component counts", () => {
    const pts = projectCohortSnapshot([r1], [webTag], [{ kind: "tag", tagId: "web" }], "count");
    expect(pts[0]).toMatchObject({ cohortKey: "tag:web", label: "web", color: "violet", value: 10, componentCount: 1 });
  });

  it("leaves out a tag series whose tag was deleted", () => {
    const pts = projectCohortSnapshot([r1], [webTag], [{ kind: "tag", tagId: "web" }, { kind: "tag", tagId: "legacy" }], "count");
    expect(pts.map((p) => p.cohortKey)).toEqual(["tag:web"]);
  });

  it("draws a component that only an older scan holds, by name, at 0", () => {
    const pts = projectCohortSnapshot([r1], [], [{ kind: "component", componentId: webCard.id }], "count", [], [a]);
    expect(pts).toEqual([{ cohortKey: `component:${webCard.id}`, label: "WebCard · @x/web-webc", color: "", value: 0, componentCount: 0 }]);
  });

  it("share = fraction of the chart's cohort total (sums to 1)", () => {
    const pts = projectCohortSnapshot([r1], [webTag, legacyTag], [{ kind: "tag", tagId: "web" }, { kind: "tag", tagId: "legacy" }], "share");
    const web = pts.find((p) => p.cohortKey === "tag:web")!;
    const legacy = pts.find((p) => p.cohortKey === "tag:legacy")!;
    expect(web.value).toBeCloseTo(10 / 17);
    expect(legacy.value).toBeCloseTo(7 / 17);
    expect(web.value + legacy.value).toBeCloseTo(1);
  });

  it("share is 0 for every cohort when the total is 0", () => {
    const empty = scan("r3", t2, [[component(repoDeclaration("r3", "src/idle.tsx", "Idle")), 0]]);
    const pts = projectCohortSnapshot([empty], [webTag], [{ kind: "tag", tagId: "web" }], "share");
    expect(pts[0]!.value).toBe(0);
  });
});

describe("projectCohortSeries", () => {
  const r1a = scan("r1", t1, [[webButton, 4]]);
  const r1b = scan("r1", t2, [[webButton, 10]]);
  const r2a = scan("r2", t2, [[webButton, 3]]);

  it("emits one point per distinct timestamp, carrying repos forward (count)", () => {
    const series = projectCohortSeries([r1a, r1b, r2a], [webTag], [{ kind: "tag", tagId: "web" }], "count");
    const web = series.find((s) => s.cohortKey === "tag:web")!;
    // t1: only r1a (4). t2: r1b (10) + r2a (3) = 13.
    expect(web.points).toEqual([{ t: t1, value: 4 }, { t: t2, value: 13, added: ["r2"] }]);
  });

  it("counts each repo from its first scan, at the series' timestamps, and names every repo it counts", () => {
    // t1: only r1 has a scan. t2: r2's first scan joins it.
    expect(projectRepoCoverage([r2a, r1a, r1b])).toEqual({ total: 2, repoIds: ["r1", "r2"], points: [{ t: t1, repos: 1 }, { t: t2, repos: 2 }] });
  });

  it("share divides by the cohort total at each time-point", () => {
    const s1 = scan("r1", t1, [[webButton, 3], [legacyCard, 1]]);
    const series = projectCohortSeries([s1], [webTag, legacyTag], [{ kind: "tag", tagId: "web" }, { kind: "tag", tagId: "legacy" }], "share");
    expect(series.find((s) => s.cohortKey === "tag:web")!.points[0]!.value).toBeCloseTo(3 / 4);
    expect(series.find((s) => s.cohortKey === "tag:legacy")!.points[0]!.value).toBeCloseTo(1 / 4);
  });

  it("carries a repo forward when it has no scan at a later timestamp", () => {
    const a1 = scan("rA", t1, [[webButton, 5]]);
    const b2 = scan("rB", t2, [[webButton, 2]]);
    const series = projectCohortSeries([a1, b2], [webTag], [{ kind: "tag", tagId: "web" }], "count");
    const web = series.find((s) => s.cohortKey === "tag:web")!;
    // t1: only rA (5). t2: rA carried forward (5) + rB (2) = 7.
    expect(web.points).toEqual([{ t: t1, value: 5 }, { t: t2, value: 7, added: ["rB"] }]);
  });

  it("carries a repo forward across many timestamps without its contribution drifting", () => {
    // One scan is the as-of set for four timestamps. Its per-cohort occurrence
    // count is resolved once and reused, so this pins that reuse against the
    // recomputed value at every later point.
    const ts = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"].map((d) => `${d}T00:00:00Z`);
    const held = scan("rHeld", ts[0]!, [[webButton, 6]]);
    const movers = ts.slice(1).map((t, i) => scan("rMover", t, [[webButton, i + 1]]));
    const series = projectCohortSeries([held, ...movers], [webTag], [{ kind: "tag", tagId: "web" }], "count");
    const web = series.find((s) => s.cohortKey === "tag:web")!;
    // rHeld contributes a flat 6 at every point; rMover adds 0, 1, 2, 3.
    expect(web.points).toEqual([
      { t: ts[0]!, value: 6 }, { t: ts[1]!, value: 7, added: ["rMover"] },
      { t: ts[2]!, value: 8 }, { t: ts[3]!, value: 9 },
    ]);
  });

  it("starts each line at the first scan of the earliest repo that has it, and marks where a repo that has it joins", () => {
    const t3 = "2026-01-03T00:00:00Z";
    const scans = [
      scan("r1", t1, [[webButton, 4]]),
      scan("r2", t2, [[legacyCard, 3], [webCard, 2]]),
      scan("r1", t3, [[webButton, 5], [legacyCard, 2]]),
    ];
    const series = projectCohortSeries(scans, [webTag, legacyTag], [
      { kind: "tag", tagId: "legacy" },
      { kind: "component", componentId: webCard.id },
      { kind: "component", componentId: webButton.id },
    ], "count");
    expect(series.map((s) => s.points)).toEqual([
      [{ t: t1, value: 0 }, { t: t2, value: 3, added: ["r2"] }, { t: t3, value: 5 }],
      [{ t: t2, value: 2 }, { t: t3, value: 2 }],
      [{ t: t1, value: 4 }, { t: t2, value: 4 }, { t: t3, value: 5 }],
    ]);
  });

  it("keeps cohorts distinct over the same carried-forward scan", () => {
    // Two cohorts read the same scan at the same timestamps. Anything that
    // caches a scan's occurrence count without distinguishing which cohort
    // asked would hand the second cohort the first's number.
    const held = scan("rHeld", t1, [[webButton, 9], [legacyCard, 2]]);
    const later = scan("rOther", t2, [[webCard, 1]]);
    const series = projectCohortSeries(
      [held, later], [webTag, legacyTag],
      [{ kind: "tag", tagId: "web" }, { kind: "tag", tagId: "legacy" }], "count",
    );
    expect(series.find((s) => s.cohortKey === "tag:web")!.points).toEqual([
      { t: t1, value: 9 }, { t: t2, value: 10, added: ["rOther"] },
    ]);
    expect(series.find((s) => s.cohortKey === "tag:legacy")!.points).toEqual([
      { t: t1, value: 2 }, { t: t2, value: 2 },
    ]);
  });
});

describe("component and deprecatedOnly cohorts", () => {
  const webLink = component(packageExport("@x/web-link", "Link"));
  const af = scan("r1", "2026-02-01T00:00:00Z", [[webButton, 10], [webCard, 5], [panel, 3], [webLink, 8]]);
  const dep: GovernanceRecord[] = [
    { id: "gr1", grain: "package", targetPackage: "@x/web-webc", targetExport: null, disposition: { kind: "retired", reason: "legacy" }, createdAt: t1, updatedAt: t1 },
  ];

  it("component cohort label disambiguates by package", () => {
    const pts = projectCohortSnapshot([af], [], [{ kind: "component", componentId: webButton.id }], "count");
    expect(pts[0]!.label).toBe("WebButton · @x/web-webc");
  });

  it("package + deprecatedOnly: counts only deprecated members", () => {
    expect(resolveCohort({ kind: "package", packageName: "@x/web-webc", deprecatedOnly: true }, af, [], dep)).toEqual({ occurrences: 15, usedKeys: new Set([webButton.id, webCard.id]) });
    expect(resolveCohort({ kind: "package", packageName: "@x/web-webc" }, af, [], dep)).toEqual({ occurrences: 15, usedKeys: new Set([webButton.id, webCard.id]) });
  });

  it("package + deprecatedOnly with no governance matches nothing", () => {
    expect(resolveCohort({ kind: "package", packageName: "@x/web-webc", deprecatedOnly: true }, af, [], [])).toEqual({ occurrences: 0, usedKeys: new Set() });
  });

  it("tag + deprecatedOnly: intersects the resolved set with the deprecated set", () => {
    expect(resolveCohort({ kind: "tag", tagId: "web" }, af, [webTag], dep)).toEqual({ occurrences: 23, usedKeys: new Set([webButton.id, webCard.id, webLink.id]) });
    expect(resolveCohort({ kind: "tag", tagId: "web", deprecatedOnly: true }, af, [webTag], dep)).toEqual({ occurrences: 15, usedKeys: new Set([webButton.id, webCard.id]) });
  });

  it("a tag's component cohort takes its label and role from the latest scan that holds it", () => {
    const tabRule: GovernanceRecord = { id: "tab", grain: "component", targetPackage: "@x/web-webc", targetExport: "web-tab", disposition: { kind: "retired", reason: "x" }, createdAt: t1, updatedAt: t1 };
    const older = scan("r2", t1, [[component(tag("web-tab"), { attribution: unknown }), 1]]);
    const newer = scan("r1", t2, [[webTab, 1]]);
    const [p] = projectCohortSnapshot([older, newer], [], [{ kind: "component", componentId: webTab.id }], "count", [tabRule]);
    expect(p).toMatchObject({ label: "web-tab · @x/web-webc", role: "deprecated" });
  });
});

describe("distinct-used componentCount", () => {
  // Repo A reaches the package through a used export ("ExampleLink", 40 occ) and also
  // holds the element tag unused (0 occ, not a headline use); repo B uses the tag
  // directly (39 occ). The package cohort's headline componentCount must be 2, not the
  // 3-appearance sum.
  const exampleLink = component(packageExport("@example/link", "ExampleLink"));
  const xLink = component(tag("x-link"), { attribution: resolvedTo("@example/link") });
  const repoA = scan("repoA", "2026-03-01T00:00:00Z", [[exampleLink, 40], [xLink, 0]]);
  const repoB = scan("repoB", "2026-03-01T00:00:00Z", [[xLink, 39]]);

  it("resolveCohort: package selector's usedKeys excludes the zero-occurrence row", () => {
    expect(resolveCohort({ kind: "package", packageName: "@example/link" }, repoA, [])).toEqual({ occurrences: 40, usedKeys: new Set([exampleLink.id]) });
    expect(resolveCohort({ kind: "package", packageName: "@example/link" }, repoB, [])).toEqual({ occurrences: 39, usedKeys: new Set([xLink.id]) });
  });

  it("projectCohortSnapshot: package cohort componentCount unions used keys across repos (2, not the 3-appearance sum)", () => {
    const pts = projectCohortSnapshot([repoA, repoB], [], [{ kind: "package", packageName: "@example/link" }], "count");
    expect(pts[0]?.componentCount).toBe(2);
    expect(pts[0]?.value).toBe(79); // occurrences: still a plain sum (40 + 39), unaffected by usage
  });

  it("a same-named repository declaration in two repos counts twice (its id names the repo)", () => {
    const r1 = scan("r1", "2026-03-01T00:00:00Z", [[component(repoDeclaration("r1", "src/shared.tsx", "Shared")), 5]]);
    const r2 = scan("r2", "2026-03-01T00:00:00Z", [[component(repoDeclaration("r2", "src/shared.tsx", "Shared")), 3]]);
    const pts = projectCohortSnapshot([r1, r2], [], [{ kind: "local" }], "count");
    expect(pts[0]?.componentCount).toBe(2);
  });
});

describe("role stamping (derived from governance)", () => {
  const supersededCard: GovernanceRecord = {
    id: "g1", grain: "component", targetPackage: "legacy-design-system", targetExport: "Card",
    disposition: { kind: "superseded", by: { packageName: "@x/web-webc" } },
    createdAt: t1, updatedAt: t1,
  };
  const retiredLegacyPkg: GovernanceRecord = {
    id: "g2", grain: "package", targetPackage: "legacy-design-system", targetExport: null,
    disposition: { kind: "retired", reason: "sunset" }, createdAt: t1, updatedAt: t1,
  };

  it("component cohort: deprecated when governance covers that component", () => {
    const [p] = projectCohortSnapshot([a], [webTag], [{ kind: "component", componentId: legacyCard.id }], "count", [supersededCard]);
    expect(p?.role).toBe("deprecated");
  });

  it("component cohort: deprecated under a package-grain record too (wholly-deprecated package)", () => {
    const [p] = projectCohortSnapshot([a], [webTag], [{ kind: "component", componentId: legacyCard.id }], "count", [retiredLegacyPkg]);
    expect(p?.role).toBe("deprecated");
  });

  it("package cohort: red only on a package-grain record (component-grain leaves it partial)", () => {
    const sel = { kind: "package" as const, packageName: "legacy-design-system" };
    expect(projectCohortSnapshot([a], [webTag], [sel], "count", [supersededCard])[0]?.role).toBeUndefined();
    expect(projectCohortSnapshot([a], [webTag], [sel], "count", [retiredLegacyPkg])[0]?.role).toBe("deprecated");
  });

  it("tag cohort: never role-stamped by plain governance (partial tags keep authored colour)", () => {
    const [p] = projectCohortSnapshot([a], [legacyTag], [{ kind: "tag", tagId: "legacy" }], "count", [retiredLegacyPkg]);
    expect(p?.role).toBeUndefined();
  });

  it("deprecatedOnly selectors stamp deprecated by construction (package and tag)", () => {
    expect(projectCohortSnapshot([a], [webTag], [{ kind: "package", packageName: "@x/web-webc", deprecatedOnly: true }], "count", [])[0]?.role).toBe("deprecated");
    expect(projectCohortSnapshot([a], [legacyTag], [{ kind: "tag", tagId: "legacy", deprecatedOnly: true }], "count", [])[0]?.role).toBe("deprecated");
  });

  it("selector-carried successor role passes through", () => {
    const [p] = projectCohortSnapshot([a], [webTag], [{ kind: "package", packageName: "@x/web-webc", role: "successor" }], "count", []);
    expect(p?.role).toBe("successor");
  });

  it("governance-derived deprecated beats selector successor (chained migration)", () => {
    const retiredWebc: GovernanceRecord = {
      id: "g3", grain: "package", targetPackage: "@x/web-webc", targetExport: null,
      disposition: { kind: "retired", reason: "superseded again" }, createdAt: t1, updatedAt: t1,
    };
    const [p] = projectCohortSnapshot([a], [webTag], [{ kind: "package", packageName: "@x/web-webc", role: "successor" }], "count", [retiredWebc]);
    expect(p?.role).toBe("deprecated");
  });

  it("series carry role identically", () => {
    const [s] = projectCohortSeries([a], [webTag], [{ kind: "component", componentId: legacyCard.id }], "count", [supersededCard]);
    expect(s?.role).toBe("deprecated");
  });

  it("local and unstamped cohorts stay role-free", () => {
    const [p] = projectCohortSnapshot([a], [webTag], [{ kind: "local" }], "count", [supersededCard]);
    expect(p?.role).toBeUndefined();
  });
});
