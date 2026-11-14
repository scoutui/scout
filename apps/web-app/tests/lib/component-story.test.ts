import { describe, expect, it } from "vitest";
import { deriveGovernanceTracking, type ComponentRow, type DigestScan, type GovernanceRecord } from "@scoutui/web-shared";
import { component, packageExport } from "../../../../packages/web-shared/tests/helpers/builders.ts";
import { componentStory, type ComponentStory } from "@/lib/component-story";

const DAY = 24 * 60 * 60 * 1000;
const LATEST = Date.UTC(2026, 10, 13);
const asOf = "2026-11-14T00:00:00.000Z";
const weekly = (weeks: number) => Array.from({ length: weeks }, (_, i) => new Date(LATEST - (weeks - 1 - i) * 7 * DAY).toISOString());
const used = (packageName: string, exportName: string, occurrenceCount: number) =>
  component(packageExport(packageName, exportName), { stats: { occurrenceCount, fileCount: 1 }, usage: "direct" });
const scanAt = (repoId: string, t: string, i: number, components: DigestScan["components"]): DigestScan =>
  ({ meta: { scanId: `${repoId}-${i}`, committedAt: t, arrivedAt: t, repo: { id: repoId } }, components });

// 24 weekly scans to 13 Nov: Button falls from 400 as its replacement, from the fifth scan, rises.
const storefront = weekly(24).map((t, i) => scanAt("r1", t, i, [
  used("@acme/old", "Button", 400 - 2 * i),
  used("@acme/old", "Card", 50),
  used("@acme/ui", "Badge", 120 - i),
  used("@acme/ui", "Chip", 60 - i),
  used("@acme/ui", "Tag", 30),
  used("@acme/next", "Pill", i),
  ...(i >= 4 ? [used("@acme/new", "Button", 3 * i)] : []),
]));
// Scanned in January, March, July and on 20 October: one scan in the three months to 6 July, and to 20 October.
const rare = ["2026-01-05", "2026-03-02", "2026-07-06", "2026-10-20"].map((d, i) => scanAt("r2", `${d}T00:00:00.000Z`, i, [used("@acme/old", "Button", 40 - i)]));

const record = (id: string, over: Partial<GovernanceRecord>): GovernanceRecord => ({
  id, grain: "component", targetPackage: "@acme/old", targetExport: "Button",
  disposition: { kind: "superseded", by: { packageName: "@acme/new", exportName: "Button" } },
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
});
const records = [
  record("g-button", {}),
  record("g-old", { grain: "package", targetExport: null, disposition: { kind: "superseded", by: { packageName: "@acme/new" } } }),
  record("g-badge", { targetPackage: "@acme/ui", targetExport: "Badge", disposition: { kind: "retired", reason: "Use Tag" } }),
  record("g-chip", { targetPackage: "@acme/ui", targetExport: "Chip", disposition: { kind: "superseded", by: { packageName: "@acme/next", exportName: "Pill" } } }),
  record("g-tag", { targetPackage: "@acme/ui", targetExport: "Tag", disposition: { kind: "superseded", by: { packageName: "@acme/next", exportName: "Pill" } } }),
];
const entryFor = (repoId: string, recordId: string) =>
  deriveGovernanceTracking(records, [...storefront, ...rare], { kind: "repo", repoId }, asOf).find((e) => e.recordIds.includes(recordId)) ?? null;

const row: ComponentRow = {
  componentId: "c1", kind: "react-component", scope: "external", packageName: "@acme/old",
  displayName: "Button", disambiguator: null, version: "1.0.0", occurrenceCount: 354, fileCount: 1, deprecated: false,
};
const history = (points: Array<[string, number]>) => points.map(([t, value]) => ({ t, value }));
const threeMonthsBack = new Date(Date.UTC(2026, 7, 13)).toISOString();

describe("componentStory", () => {
  it.each<[string, Omit<Parameters<typeof componentStory>[0], "olderScanAt">, Partial<ComponentStory> & { points?: Array<[string, number]>[] }]>([
    ["a replaced component: its tracking entry from three months back, with the chart opening there",
      { repoId: "r1", row, mark: undefined, entry: entryFor("r1", "g-button"), history: null },
      { kind: "migration", range: "3m", href: "/charts/migration%3Ag-button?repo=r1&range=3m", wholePackages: [], components: null, empty: null }],
    ["a component a package-wide record covers: that package's entry, named whole",
      { repoId: "r1", row: { ...row, displayName: "Card" }, mark: undefined, entry: entryFor("r1", "g-old"), history: null },
      { kind: "migration", href: "/charts/migration%3Ag-old?repo=r1&range=3m", wholePackages: ["@acme/old"], components: null }],
    ["a component whose record shares its replacement with another: their one entry, counting both components",
      { repoId: "r1", row: { ...row, packageName: "@acme/ui", displayName: "Chip" }, mark: undefined, entry: entryFor("r1", "g-chip"), history: null },
      { kind: "migration", href: "/charts/migration%3Ag-chip?repo=r1&range=3m", wholePackages: [], components: 2 }],
    ["a retired component",
      { repoId: "r1", row: { ...row, displayName: "Badge" }, mark: undefined, entry: entryFor("r1", "g-badge"), history: null },
      { kind: "retirement", href: "/charts/retirement%3Ag-badge?repo=r1&range=3m", wholePackages: [] }],
    ["a repo with one scan in the three months to its latest: every scan, with the chart opening on all",
      { repoId: "r2", row, mark: undefined, entry: entryFor("r2", "g-button"), history: null },
      { kind: "migration", range: "all", href: "/charts/migration%3Ag-button?repo=r2&range=all" }],
    ["a component without a tracking entry: its uses from three months back",
      { repoId: "r1", row, mark: undefined, entry: null, history: history([["2026-07-01T00:00:00.000Z", 30], ["2026-08-01T00:00:00.000Z", 32], ["2026-09-01T00:00:00.000Z", 35], [new Date(LATEST).toISOString(), 40]]) },
      { kind: "uses", range: "3m", href: null, empty: null, points: [[[threeMonthsBack, 32], ["2026-09-01T00:00:00.000Z", 35], [new Date(LATEST).toISOString(), 40]]] }],
    ["uses all inside three months: every point",
      { repoId: "r1", row, mark: undefined, entry: null, history: history([["2026-10-01T00:00:00.000Z", 3], ["2026-11-01T00:00:00.000Z", 4]]) },
      { kind: "uses", range: "3m", points: [[["2026-10-01T00:00:00.000Z", 3], ["2026-11-01T00:00:00.000Z", 4]]] }],
    ["uses with one scan in the three months to the shown scan: every scan",
      { repoId: "r1", row, mark: undefined, entry: null, history: history([["2026-03-01T00:00:00.000Z", 3], ["2026-06-01T00:00:00.000Z", 4], ["2026-10-01T00:00:00.000Z", 5]]) },
      { kind: "uses", range: "all", points: [[["2026-03-01T00:00:00.000Z", 3], ["2026-06-01T00:00:00.000Z", 4], ["2026-10-01T00:00:00.000Z", 5]]] }],
    ["a component new in this scan",
      { repoId: "r1", row, mark: { kind: "added" }, entry: null, history: history([["2026-11-13T00:00:00.000Z", 5]]) },
      { kind: "uses", empty: "new" }],
    ["a repo's first scan",
      { repoId: "r1", row, mark: undefined, entry: null, history: history([["2026-11-13T00:00:00.000Z", 5]]) },
      { kind: "uses", empty: "one-scan" }],
  ])("tells %s", (_title, input, { points, ...expected }) => {
    const story = componentStory({ ...input, olderScanAt: null });
    expect(story).toMatchObject(expected);
    if (points) expect(story?.series.map((s) => s.points.map((p) => [p.t, p.value]))).toEqual(points);
  });

  it("waits for the component's history when no tracking entry charts it", () => {
    expect(componentStory({ repoId: "r1", row, mark: undefined, entry: null, history: null, olderScanAt: null })).toBeNull();
  });

  it.each<[string, string, string | null, Partial<ComponentStory>, unknown[]]>([
    ["the latest scan: the three months to it", "r1", null, { range: "3m" }, [
      ["deprecated", { t: threeMonthsBack, value: 382 }, 354],
      ["successor", { t: threeMonthsBack, value: 27 }, 69],
    ]],
    ["an older scan: the three months to that scan, ending at its counts", "r1", storefront[18]?.meta.committedAt ?? null, { range: "3m" }, [
      ["deprecated", { t: "2026-07-09T00:00:00.000Z", value: 392 }, 364],
      ["successor", { t: "2026-07-09T00:00:00.000Z", value: 12 }, 54],
    ]],
    ["an older scan with one scan in the three months to it: every scan to it", "r2", "2026-07-06T00:00:00.000Z", { range: "all" }, [
      ["deprecated", { t: "2026-01-05T00:00:00.000Z", value: 40 }, 38],
      ["successor", { t: "2026-01-05T00:00:00.000Z", value: 0 }, 0],
    ]],
  ])("draws a migration's two counts from its stored entry on %s", (_title, repoId, olderScanAt, expected, lines) => {
    const story = componentStory({ repoId, row, mark: undefined, entry: entryFor(repoId, "g-button"), history: null, olderScanAt });
    expect(story).toMatchObject(expected);
    expect(story?.series.map((s) => [s.role, s.points[0], s.points.at(-1)?.value])).toEqual(lines);
  });

  it("keeps the latest scan's chart link on an older scan whose own window differs", () => {
    const story = componentStory({ repoId: "r2", row, mark: undefined, entry: entryFor("r2", "g-button"), history: null, olderScanAt: "2026-03-02T00:00:00.000Z" });
    expect(story).toMatchObject({ range: "3m", href: "/charts/migration%3Ag-button?repo=r2&range=all" });
  });
});
