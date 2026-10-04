import { describe, it, expect } from "vitest";
import { componentKey, type Component, type ScanArtifact, type TagAttribution } from "@scoutui/scan-format";
import { PostgresDriver } from "../../src/drivers/postgres.js";
import { projectCohortSeries } from "../../src/cohorts.js";
import { artifact, component, packageExport, repoDeclaration, resolvedAt, tag } from "../helpers/builders.js";
import { tinyArtifact } from "../fixtures/tiny-artifact.js";
import { withReadModelDatabase } from "../../../../apps/web-app/tests/helpers/read-model-db.ts";
import { publishScan } from "../../../../apps/web-app/src/lib/scan-projection.ts";

/** A scan of `repoId` on its own commit, holding each component with that many call sites. */
function scanOf(repoId: string, scannedAt: string, uses: Array<[Component, number]>, scanId = repoId): ScanArtifact {
  const occurrences = uses.flatMap(([c, count]) => Array.from({ length: count }, (_, index) => resolvedAt(c, "src/App.tsx", index + 1)));
  const scan = artifact({ repoId, scanId, scannedAt, components: uses.map(([c]) => c), occurrences });
  scan.meta.repo.commit = scanId;
  return scan;
}

const attributedTo = (packageName: string): TagAttribution => ({ status: "resolved", target: { kind: "package", packageName }, confidence: "observed", evidence: [] });
const unattributed: TagAttribution = { status: "unknown", reason: "absent", evidence: [] };

describe.skipIf(!process.env.DATABASE_URL)("PostgresDriver published scans", () => {
  it("lists repos by latest scan time descending, then scan ID descending", async () => {
    await withReadModelDatabase(async pool => {
      for (const artifact of [
        tinyArtifact({ repoId: "repo-a", scanId: "oldest", scannedAt: "2026-05-18T09:00:00Z" }),
        tinyArtifact({ repoId: "repo-z", scanId: "newest-z", scannedAt: "2026-05-18T11:00:00Z" }),
        tinyArtifact({ repoId: "repo-y", scanId: "newest-a", scannedAt: "2026-05-18T11:00:00Z" }),
        tinyArtifact({ repoId: "repo-a", scanId: "middle", scannedAt: "2026-05-18T10:00:00Z" }),
      ]) await publishScan(pool, artifact, { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      expect((await driver.listRepos()).map(repo => ({ repoId: repo.repoId, scanCount: repo.scanCount }))).toEqual([
        { repoId: "repo-z", scanCount: 1 },
        { repoId: "repo-y", scanCount: 1 },
        { repoId: "repo-a", scanCount: 2 },
      ]);
    });
  });

  // Each scan: id, commit date, arrival time, branch position, and its @x/wc call sites. Ids run against the expected order.
  it.each([
    { name: "a newer commit before an older one", scans: [
      ["a-newer", "2026-05-18T12:00:00Z", "2026-05-18T12:05:00Z", null, 2],
      ["b-older", "2026-05-17T12:00:00Z", "2026-05-17T12:05:00Z", null, 1],
    ], points: [["2026-05-17T12:00:00.000Z", 1], ["2026-05-18T12:00:00.000Z", 2]] },
    { name: "a newer commit before an older commit uploaded later", scans: [
      ["a-newer", "2026-05-18T12:00:00Z", "2026-05-18T12:30:00Z", null, 2],
      ["b-older", "2026-05-17T12:00:00Z", "2026-05-19T09:00:00Z", null, 1],
    ], points: [["2026-05-17T12:00:00.000Z", 1], ["2026-05-18T12:00:00.000Z", 2]] },
    { name: "a commit dated in the future after the commits that arrived later", scans: [
      ["a-after", "2026-05-18T12:00:00Z", "2026-05-18T12:05:00Z", null, 2],
      ["b-ahead", "2026-05-25T12:00:00Z", "2026-05-17T12:00:00Z", null, 1],
    ], points: [["2026-05-17T12:00:00.000Z", 1], ["2026-05-18T12:00:00.000Z", 2]] },
    { name: "commits with one date by their position on the branch, unknown positions last", scans: [
      ["a-tip", "2026-05-18T12:00:00Z", "2026-05-18T12:05:00Z", 3, 9],
      ["b-before", "2026-05-18T12:00:00Z", "2026-05-18T12:05:00Z", 2, 1],
      ["c-unknown", "2026-05-18T12:00:00Z", "2026-05-18T12:05:00Z", null, 1],
    ], points: [["2026-05-18T12:00:00.000Z", 9]] },
  ] as const)("orders a repo's scans newest first: $name", async ({ scans, points }) => {
    await withReadModelDatabase(async pool => {
      for (const [scanId, committedAt, , position, calls] of scans) {
        const scan = tinyArtifact({ scanId, commit: scanId, committedAt, scannedAt: committedAt });
        if (position !== null) scan.meta.repo.branchPosition = position;
        scan.components[0] = { ...scan.components[0]!, stats: { occurrenceCount: calls, fileCount: 1 } };
        await publishScan(pool, scan, { uploadedByUserId: null });
      }
      for (const [scanId, , arrivedAt] of scans) await pool.query("UPDATE scans SET created_at = $2 WHERE scan_id = $1", [scanId, arrivedAt]);
      const driver = new PostgresDriver(pool);
      expect((await driver.listScans("tiny-repo")).map(scan => [scan.scanId, scan.committedAt, scan.arrivedAt]))
        .toEqual(scans.map(([scanId, committedAt, arrivedAt]) => [scanId, new Date(committedAt).toISOString(), new Date(arrivedAt).toISOString()]));
      expect(await driver.getRepo("tiny-repo")).toMatchObject({ scanId: scans[0][0], diff: { baselineScanId: scans[1][0] } });
      expect(projectCohortSeries(await driver.listScanDigests("tiny-repo"), [], [{ kind: "package", packageName: "@x/wc" }], "count")[0]?.points)
        .toEqual(points.map(([t, value]) => ({ t, value })));
    });
  });

  it("returns summaries, historic rows, selected scans and scan history", async () => {
    await withReadModelDatabase(async pool => {
      const driver = new PostgresDriver(pool);
      const first = tinyArtifact({ scanId: "S1", scannedAt: "2026-05-18T10:00:00Z" });
      first.components.splice(1, 1);
      const second = tinyArtifact({ scanId: "S2", scannedAt: "2026-05-18T11:00:00Z" });
      await publishScan(pool, first, { uploadedByUserId: null });
      await publishScan(pool, second, { uploadedByUserId: null });
      const summary = (await driver.listRepos())[0];
      expect(summary?.scanCount).toBe(2);
      expect(summary?.delta).toEqual({ added: 1, removed: 0, changed: 0, deprecated: 0 });
      expect((await driver.getRepo("tiny-repo"))?.scanId).toBe("S2");
      expect((await driver.getRepo("tiny-repo", "S1"))?.diff).toBeNull();
      expect((await driver.listComponentsForRepo("tiny-repo", "", "S1")).length).toBe(1);
      expect((await driver.listScans("tiny-repo")).map(scan => scan.scanId)).toEqual(["S2", "S1"]);
      expect(await driver.getRepo("tiny-repo", "MISSING")).toBeNull();
      expect(await driver.getRepo("missing")).toBeNull();
    });
  });

  it("serves selected component heads and explicit Usage with query filtering", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, tinyArtifact(), { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      const id = componentKey(tag("x-button"));
      expect((await driver.listComponentsForRepo("tiny-repo", ""))[0]?.displayName).toBe("x-button");
      expect(await driver.listComponentsForRepo("tiny-repo", "deprecated:true")).toEqual([]);
      expect(await driver.listComponentsForRepo("tiny-repo", "(")).toEqual([]);
      const head = await driver.getComponentDetailHead("tiny-repo", id);
      expect(head?.displayName).toBe("x-button");
      expect(head).not.toHaveProperty("occurrences");
      const usage = await driver.getComponentUsage("tiny-repo", id);
      expect(usage).toHaveLength(1);
      expect(await driver.getComponentDetailHead("tiny-repo", "missing")).toBeNull();
      expect(await driver.getComponentUsage("tiny-repo", "missing")).toEqual([]);
    });
  });

  const conflict = (candidates: Extract<TagAttribution, { status: "conflict" }>["candidates"]): TagAttribution => ({ status: "conflict", strongestClass: "declared", candidates, evidence: [] });
  const inRepo = (filePath: string) => ({ kind: "repository" as const, repoId: "claims", filePath, exportName: "Badge" });
  it.each([
    ["two packages", conflict([{ kind: "package", packageName: "@example/ui" }, { kind: "package", packageName: "@other/ui" }]), ["@example/ui", "@other/ui"]],
    ["two files in the repo", conflict([inRepo("src/a.ts"), inRepo("src/b.ts")]), ["src/a.ts", "src/b.ts"]],
    ["a package and a file in the repo", conflict([{ kind: "package", packageName: "@example/ui" }, inRepo("src/a.ts")]), ["@example/ui", "src/a.ts"]],
    ["none for a tag one package resolves to", attributedTo("@example/ui"), []],
  ])("lists the claimants on a tag's detail head: %s", async (_, attribution, claimedBy) => {
    await withReadModelDatabase(async pool => {
      const badge = component(tag("x-badge"), { attribution });
      await publishScan(pool, scanOf("claims", "2026-06-01T00:00:00.000Z", [[badge, 1]]), { uploadedByUserId: null });
      expect((await new PostgresDriver(pool).getComponentDetailHead("claims", badge.id))?.claimedBy).toEqual(claimedBy);
    });
  });

  it("unions identities and consumers across repos while keeping scoped packages", async () => {
    await withReadModelDatabase(async pool => {
      for (const repoId of ["repo-a", "repo-b"]) {
        await publishScan(pool, tinyArtifact({ repoId, scanId: repoId }), { uploadedByUserId: null });
      }
      const driver = new PostgresDriver(pool);
      const pkg = (await driver.listPackages()).find(row => row.packageName === "@x/wc");
      expect(pkg).toMatchObject({ consumerCount: 2, componentCount: 1, totalOccurrences: 2, distinctVersionCount: 1 });
      expect((await driver.listPackages("repo-a"))[0]).toMatchObject({ consumerCount: 1, totalOccurrences: 1 });
      expect(await driver.getPackage("@x/wc")).toMatchObject({ consumerCount: 2, componentCount: 1 });
      const id = componentKey(tag("x-button"));
      expect(await driver.getCrossRepoComponent(id)).toMatchObject({ repoCount: 2, totalOccurrences: 2 });
      expect((await driver.listComponents()).find(row => row.componentId === id)).toMatchObject({ repoCount: 2, totalOccurrences: 2 });
      expect(await driver.getPackage("missing")).toBeNull();
      expect(await driver.getCrossRepoComponent("missing")).toBeNull();
    });
  });

  it("compares a historic scan with its own predecessor, and reads its digests by window or by component", async () => {
    await withReadModelDatabase(async pool => {
      for (const [index, time] of ["10", "11", "12"].entries()) {
        const artifact = tinyArtifact({ scanId: `S${index + 1}`, scannedAt: `2026-05-18T${time}:00:00Z` });
        if (!index) artifact.components.splice(1, 1);
        await publishScan(pool, artifact, { uploadedByUserId: null });
      }
      const driver = new PostgresDriver(pool);
      expect((await driver.getRepo("tiny-repo"))?.diff).toMatchObject({ baselineScanId: "S2", added: 0 });
      expect((await driver.getRepo("tiny-repo", "S2"))?.diff).toMatchObject({ baselineScanId: "S1", added: 1 });
      expect((await driver.getRepo("tiny-repo", "S1"))?.diff).toBeNull();
      expect((await driver.listScanDigests(undefined, { newestPerRepo: 2 })).map(scan => scan.meta.scanId)).toEqual(["S2", "S3"]);
      expect((await driver.listScanDigests()).map(scan => scan.meta.scanId)).toEqual(["S1", "S2", "S3"]);
      const card = tinyArtifact().components[1]?.id ?? "";
      expect((await driver.listScanDigests(undefined, { componentIds: [card] })).map(scan => [scan.meta.scanId, scan.components.map(c => c.id)]))
        .toEqual([["S2", [card]], ["S3", [card]]]);
    });
  });

  it("reads stored digest usage without deriving replacements", async () => {
    await withReadModelDatabase(async pool => {
      const artifact = tinyArtifact();
      artifact.components[0].usage = "none";
      await publishScan(pool, artifact, { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      expect((await driver.listScanDigests())[0]?.components[0]).toMatchObject({ usage: "none" });
      await pool.query("UPDATE scans SET artifact = '{}'::json");
      expect((await driver.listScanDigests())[0]?.components[0]).toMatchObject({ usage: "none" });
      expect((await driver.listRepos())[0]?.repoId).toBe("tiny-repo");
    });
  });

  it("summarises a repo's newest scan on the repos list and the repo page", async () => {
    await withReadModelDatabase(async pool => {
      const button = component(packageExport("@example/ui", "Button"));
      const dialog = component(packageExport("@example/ui", "Dialog"));
      const field = component(packageExport("@example/forms", "Field"), { framework: "vue" });
      const panel = component(repoDeclaration("sample-app", "src/Panel.tsx", "Panel"));
      for (const [scanId, scannedAt, components] of [
        ["S1", "2026-06-01T00:00:00.000Z", [button, dialog, panel]],
        ["S2", "2026-06-02T00:00:00.000Z", [button, dialog, field, panel]],
      ] as const) {
        const scan = scanOf("sample-app", scannedAt, components.map(c => [c, 1]), scanId);
        scan.meta.repo.gitRemote = "git@example.com:example/sample-app.git";
        scan.meta.repo.initialCommit = "c0ffee";
        await publishScan(pool, scan, { uploadedByUserId: null });
      }
      const driver = new PostgresDriver(pool);
      const summary = {
        repoId: "sample-app",
        gitRemote: "git@example.com:example/sample-app.git",
        commit: "S2",
        scanCount: 2,
        componentCount: 4,
        externalComponentCount: 3,
        localComponentCount: 1,
        packageCount: 2,
        totalOccurrences: 4,
        frameworkCounts: [{ kind: "react-component", count: 3 }, { kind: "vue-component", count: 1 }],
        delta: { added: 1, removed: 0, changed: 0, deprecated: 0 },
      };
      expect(await driver.listRepos()).toMatchObject([summary]);
      expect(await driver.getRepo("sample-app")).toMatchObject({ ...summary, scanId: "S2", initialCommit: "c0ffee", scannerVersion: "0.0.0-test" });
    });
  });

  it("lists a repo's components with their versions and the other names files use, telling same-named ones apart by entry or file", async () => {
    await withReadModelDatabase(async pool => {
      const link = component(packageExport("@example/router", "default", "./link"), { version: "6.0.0", writtenNames: ["NavLink", "Link"] });
      const components = [
        link,
        component(packageExport("@example/ui", "Header", "./card/header"), { version: "1.0.0" }),
        component(packageExport("@example/ui", "Header", "./page/header"), { version: "1.0.0" }),
        component(repoDeclaration("sample-app", "src/card/Header.tsx", "Header")),
        component(repoDeclaration("sample-app", "src/page/Header.tsx", "Header")),
      ];
      const occurrences = [
        resolvedAt(link, "src/Nav.tsx", 1, { writtenName: "NavLink" }),
        resolvedAt(link, "src/Nav.tsx", 2, { writtenName: "NavLink" }),
        resolvedAt(link, "src/Footer.tsx", 1, { writtenName: "Link" }),
      ];
      await publishScan(pool, artifact({ repoId: "sample-app", components, occurrences }), { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      // "Link" only changes the case of the display name "link", so it is not listed as another name.
      expect(await driver.listComponentsForRepo("sample-app", "")).toMatchObject([
        { displayName: "link", writtenNames: ["NavLink"], disambiguator: null, version: "6.0.0" },
        { displayName: "Header", disambiguator: "./card/header", version: "1.0.0" },
        { displayName: "Header", disambiguator: "./page/header", version: "1.0.0" },
        { displayName: "Header", disambiguator: "src/card/Header.tsx", version: null },
        { displayName: "Header", disambiguator: "src/page/Header.tsx", version: null },
      ]);
      expect((await driver.listComponentsForRepo("sample-app", "NavLink")).map(row => row.componentId)).toEqual([link.id]);
    });
  });

  it("shows a component's props against its declared API, what it renders, where it is defined, and the props at each call site", async () => {
    await withReadModelDatabase(async pool => {
      const button = component(packageExport("@example/ui", "Button"), { props: { onClick: { values: [], dynamic: 1, omitted: 0 } } });
      const panel = component(repoDeclaration("sample-app", "src/Panel.tsx", "Panel"), {
        definition: { line: 18, column: 6 },
        declared: { props: { size: { type: "'sm' | 'lg'", default: "sm" }, tone: { type: "string" } }, hasRest: true },
        props: {
          size: { values: [{ provenance: "written", value: "lg", count: 2 }, { provenance: "reference", ref: "props.size", count: 1 }], dynamic: 0, omitted: 0 },
          className: { values: [{ provenance: "written", value: "wide", count: 1 }], dynamic: 0, omitted: 2 },
        },
        composition: { rendersByCount: { [button.id]: 1 }, renderedByCount: {}, isRootCount: 3, isLeafCount: 0 },
      });
      button.composition.renderedByCount[panel.id] = 1;
      const occurrences = [
        resolvedAt(panel, "src/App.tsx", 1, { props: { size: { tier: "written", value: "lg" }, className: { tier: "written", value: "wide" } } }),
        resolvedAt(panel, "src/App.tsx", 2, { props: { size: { tier: "written", value: "lg" } } }),
        resolvedAt(panel, "src/Settings.tsx", 1, { props: { size: { tier: "reference", ref: "props.size" } } }),
        resolvedAt(button, "src/Panel.tsx", 20, { ownerComponentId: panel.id, props: { onClick: { tier: "dynamic" } } }),
      ];
      await publishScan(pool, artifact({ repoId: "sample-app", components: [button, panel], occurrences }), { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      const unwritten = { dynamicCount: 0, omittedCount: 0, truncatedWrittenCount: 0 };
      expect(await driver.getComponentDetailHead("sample-app", panel.id)).toMatchObject({
        repoId: "sample-app",
        hasDeclaredApi: true,
        definedAt: { filePath: "src/Panel.tsx", line: 18, column: 6 },
        props: [
          { name: "size", written: [{ value: "lg", count: 2 }], references: [{ ref: "props.size", count: 1 }], ...unwritten, status: "used", declared: { type: "'sm' | 'lg'", required: null, default: "sm" } },
          { name: "className", written: [{ value: "wide", count: 1 }], references: [], ...unwritten, omittedCount: 2, status: "undeclared", declared: null },
          { name: "tone", written: [], references: [], ...unwritten, status: "unused", declared: { type: "string", required: null, default: null } },
        ],
        composition: { renders: [{ componentId: button.id, displayName: "Button", packageName: "@example/ui", scope: "external", count: 1 }], renderedBy: [] },
        summary: { provenance: { written: 3, reference: 1, dynamic: 0 } },
      });
      expect(await driver.getComponentDetailHead("sample-app", button.id)).toMatchObject({
        hasDeclaredApi: false,
        props: [{ name: "onClick", written: [], references: [], dynamicCount: 1, status: null, declared: null }],
      });
      expect((await driver.getComponentUsage("sample-app", panel.id)).map(row => row.props)).toEqual([
        [{ kind: "literal", name: "size", value: "lg" }, { kind: "literal", name: "className", value: "wide" }],
        [{ kind: "literal", name: "size", value: "lg" }],
        [{ kind: "reference", name: "size", ref: "props.size" }],
      ]);
    });
  });

  it("lists a component's written and reference values, events and rendered components most used first", async () => {
    await withReadModelDatabase(async pool => {
      const icon = component(packageExport("@example/ui", "Icon"));
      const button = component(packageExport("@example/ui", "Button"));
      const card = component(repoDeclaration("sample-app", "src/Card.tsx", "Card"), {
        props: {
          size: {
            values: [
              { provenance: "written", value: "sm", count: 1 }, { provenance: "written", value: "lg", count: 2 },
              { provenance: "reference", ref: "props.small", count: 1 }, { provenance: "reference", ref: "props.large", count: 2 },
            ],
            dynamic: 0, omitted: 0,
          },
        },
        events: { blur: { boundCount: 1 }, click: { boundCount: 2 } },
        composition: { rendersByCount: { [icon.id]: 1, [button.id]: 2 }, renderedByCount: {}, isRootCount: 1, isLeafCount: 0 },
      });
      icon.composition.renderedByCount[card.id] = 1;
      button.composition.renderedByCount[card.id] = 2;
      await publishScan(pool, artifact({ repoId: "sample-app", components: [icon, button, card], occurrences: [] }), { uploadedByUserId: null });
      expect(await new PostgresDriver(pool).getComponentDetailHead("sample-app", card.id)).toMatchObject({
        props: [{ name: "size", written: [{ value: "lg", count: 2 }, { value: "sm", count: 1 }], references: [{ ref: "props.large", count: 2 }, { ref: "props.small", count: 1 }] }],
        events: [{ name: "click", boundCount: 2 }, { name: "blur", boundCount: 1 }],
        composition: { renders: [{ componentId: button.id, count: 2 }, { componentId: icon.id, count: 1 }] },
      });
    });
  });

  it("totals each package across repos and breaks one down by repo, version and component", async () => {
    await withReadModelDatabase(async pool => {
      const scannedAt = "2026-06-01T00:00:00.000Z";
      const ui = (exportName: string, version: string) => component(packageExport("@example/ui", exportName), { version });
      const icon = component(packageExport("@example/icons", "Icon"), { version: "2.0.0" });
      await publishScan(pool, scanOf("repo-a", scannedAt, [[ui("Button", "1.0.0"), 3], [ui("Card", "1.0.0"), 1], [ui("Tooltip", "1.0.0"), 0], [icon, 2]]), { uploadedByUserId: null });
      await publishScan(pool, scanOf("repo-b", scannedAt, [[ui("Button", "1.1.0"), 2]]), { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      // Tooltip is never rendered, so it adds no used component to its package.
      const uiTotals = { packageName: "@example/ui", consumerCount: 2, componentCount: 2, totalOccurrences: 6, deprecatedCount: 0, distinctVersionCount: 2, soleVersion: null };
      expect(await driver.listPackages()).toEqual([
        uiTotals,
        { packageName: "@example/icons", consumerCount: 1, componentCount: 1, totalOccurrences: 2, deprecatedCount: 0, distinctVersionCount: 1, soleVersion: "2.0.0" },
      ]);
      const row = (exportName: string, totalOccurrences: number, consumerCount: number, usage: Component["usage"]) => ({
        componentId: componentKey(packageExport("@example/ui", exportName)), displayName: exportName, kind: "react-component", disambiguator: null, totalOccurrences, consumerCount, deprecated: false, usage,
      });
      expect(await driver.getPackage("@example/ui")).toEqual({
        ...uiTotals,
        cells: [
          { repoId: "repo-a", version: "1.0.0", occurrenceCount: 4, committedAt: scannedAt },
          { repoId: "repo-b", version: "1.1.0", occurrenceCount: 2, committedAt: scannedAt },
        ],
        components: [row("Button", 5, 2, "direct"), row("Card", 1, 1, "direct"), row("Tooltip", 0, 1, "none")],
      });
    });
  });

  it("lists each component once across repos as its newest scan presents it, and shows one component's use repo by repo", async () => {
    await withReadModelDatabase(async pool => {
      const button = (version: string) => component(packageExport("@example/ui", "Button"), { version });
      const card = (attribution: TagAttribution) => component(tag("x-card"), { attribution });
      const panel = component(repoDeclaration("repo-a", "src/Panel.tsx", "Panel"));
      await publishScan(pool, scanOf("repo-a", "2026-06-01T00:00:00.000Z", [[button("1.0.0"), 1], [panel, 1], [card(attributedTo("@example/ui")), 0]]), { uploadedByUserId: null });
      await publishScan(pool, scanOf("repo-b", "2026-06-02T00:00:00.000Z", [[button("1.1.0"), 3], [card(unattributed), 2]]), { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      const buttonId = componentKey(packageExport("@example/ui", "Button"));
      const cardId = componentKey(tag("x-card"));
      // repo-b's scan is newer, so x-card shows as repo-b sees it: used, and attributed to no package.
      expect(await driver.listComponents()).toMatchObject([
        { componentId: buttonId, packageName: "@example/ui", totalOccurrences: 4, repoCount: 2, repoId: null, usage: "direct" },
        { componentId: cardId, packageName: null, totalOccurrences: 2, repoCount: 2, repoId: null, usage: "direct" },
        { componentId: panel.id, packageName: null, totalOccurrences: 1, repoCount: 1, repoId: "repo-a", usage: "direct" },
      ]);
      expect(await driver.getCrossRepoComponent(buttonId)).toMatchObject({
        repoCount: 2,
        totalOccurrences: 4,
        distinctVersionCount: 2,
        usages: [
          { repoId: "repo-b", version: "1.1.0", occurrenceCount: 3, committedAt: "2026-06-02T00:00:00.000Z" },
          { repoId: "repo-a", version: "1.0.0", occurrenceCount: 1, committedAt: "2026-06-01T00:00:00.000Z" },
        ],
      });
      expect(await driver.getCrossRepoComponent(panel.id)).toMatchObject({ repoCount: 1, distinctVersionCount: 0, usages: [{ repoId: "repo-a", version: null }] });
    });
  });

  it("marks a component deprecated and used across repos when any repo's scan does, whichever repo is read first", async () => {
    await withReadModelDatabase(async pool => {
      const scannedAt = "2026-06-01T00:00:00.000Z";
      // Each tag is attributed to the retired package and rendered in one repo only, and the two tags swap repos.
      const seen = (name: string) => component(tag(name), { attribution: attributedTo("@example/ui"), usage: "direct" });
      const unseen = (name: string) => component(tag(name), { attribution: unattributed, usage: "none" });
      await publishScan(pool, scanOf("repo-a", scannedAt, [[seen("x-first"), 1], [unseen("x-second"), 0]]), { uploadedByUserId: null });
      await publishScan(pool, scanOf("repo-b", scannedAt, [[unseen("x-first"), 0], [seen("x-second"), 1]]), { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      await driver.createGovernance({ grain: "package", targetPackage: "@example/ui", targetExport: null, disposition: { kind: "retired", reason: "Use the new design system" } });
      expect(await driver.listComponents()).toEqual(expect.arrayContaining([
        expect.objectContaining({ componentId: componentKey(tag("x-first")), repoCount: 2, deprecated: true, usage: "direct" }),
        expect.objectContaining({ componentId: componentKey(tag("x-second")), repoCount: 2, deprecated: true, usage: "direct" }),
      ]));
    });
  });
});
