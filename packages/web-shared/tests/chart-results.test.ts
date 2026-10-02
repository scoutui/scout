import { describe, it, expect } from "vitest";
import type { Dashboard, DashboardConfig, GovernanceRecord } from "../src/dto.js";
import { type GovernanceTracking, deriveGovernanceTracking } from "../src/governance-tracking.js";
import { deriveRecordStats } from "../src/governance-registry.js";
import { renderDashboard } from "../src/dashboard-render.js";
import { chartResultKey, chartResultRows, deriveChartResults } from "../src/chart-results.js";
import { received } from "./helpers/builders.js";
import { canonical } from "./helpers/canonical.js";
import { genericArtifacts, governance as fixtureGovernance, tags } from "./helpers/fixtures.js";

const digests = genericArtifacts().map(scan => received(scan));
const repoIds = [...new Set(digests.map((d) => d.meta.repo.id))];

const governance: GovernanceRecord[] = [
  ...fixtureGovernance,
  { id: "field", grain: "component", targetPackage: "@sample/mixed", targetExport: "Field", disposition: { kind: "superseded", by: { packageName: "@sample/core", exportName: "Button" } }, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "absent", grain: "package", targetPackage: "@sample/absent", targetExport: null, disposition: { kind: "retired", reason: "Never shipped" }, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
];

const dashboard = (id: string, config: DashboardConfig): Dashboard => ({
  id, name: id, description: null, config, createdByUserId: null, createdAt: "2026-01-01", updatedAt: "2026-01-01",
});
const estateDashboard = dashboard("estate-trend", { scope: { kind: "all" }, cohorts: [{ kind: "tag", tagId: "core" }, { kind: "local" }], chartType: "trend", metric: "count" });
const repoDashboard = dashboard("repo-bars", { scope: { kind: "repo", repoId: "repo-a" }, cohorts: [{ kind: "package", packageName: "@sample/core" }], chartType: "bars", metric: "count" });
const missingRepoDashboard = dashboard("gone-repo", { scope: { kind: "repo", repoId: "repo-gone" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "share" });
const dashboards = [estateDashboard, repoDashboard, missingRepoDashboard];

const input = { digests, tags, governance, dashboards };

const DAY1 = "2026-06-01T00:00:00Z";
const DAY2 = "2026-06-02T00:00:00Z";
const headline = (tracking: GovernanceTracking[] | undefined) =>
  tracking?.map(({ id, remaining, progress, delta }) => ({ id, remaining, progress, delta }));

describe("deriveChartResults", () => {
  it("covers migrations, retirements and a never-matched record in the fixture", () => {
    const tracking = deriveGovernanceTracking(governance, digests, { kind: "all" });
    expect(new Set(tracking.map((t) => t.kind))).toEqual(new Set(["migration", "retirement"]));
    expect(deriveRecordStats(governance, digests).stats.absent?.status).toBe("unseen");
    expect(repoIds).toEqual(expect.arrayContaining(["repo-a", "repo-b", "repo-empty"]));
  });

  it("tracks each record across the estate and per repo", () => {
    const results = deriveChartResults(input);
    expect(results.tracking).toMatchObject([
      { id: "retirement:package", remaining: 6, progress: null, delta: 3, series: [{ role: "deprecated", points: [{ t: DAY1, value: 3 }, { t: DAY2, value: 6 }] }] },
      {
        id: "migration:exact", remaining: 3, progress: 0, delta: 0,
        series: [{ role: "deprecated", points: [{ t: DAY1, value: 2 }, { t: DAY2, value: 3 }] }, { role: "successor", points: [{ t: DAY1, value: 0 }, { t: DAY2, value: 0 }] }],
      },
      {
        id: "migration:field", remaining: 2, progress: 0.6, delta: null,
        series: [{ role: "deprecated", points: [{ t: DAY2, value: 2 }] }, { role: "successor", points: [{ t: DAY2, value: 3 }] }],
      },
    ]);
    expect(results.tracking.every((t) => t.config.scope.kind === "all")).toBe(true);

    expect(Object.keys(results.repoTracking).sort()).toEqual([...repoIds].sort());
    expect(results.repoTracking["repo-empty"]).toEqual([]);
    expect(headline(results.repoTracking["repo-a"])).toEqual([
      { id: "retirement:package", remaining: 3, progress: null, delta: 0 },
      { id: "migration:exact", remaining: 2, progress: 0, delta: 0 },
      { id: "migration:field", remaining: 1, progress: expect.closeTo(2 / 3), delta: null },
    ]);
    expect(headline(results.repoTracking["repo-b"])).toEqual([
      { id: "retirement:package", remaining: 3, progress: null, delta: null },
      { id: "migration:exact", remaining: 1, progress: 0, delta: null },
      { id: "migration:field", remaining: 1, progress: 0.5, delta: null },
    ]);
    expect(results.repoTracking["repo-a"]?.every((t) => t.config.scope.kind === "repo" && t.config.scope.repoId === "repo-a")).toBe(true);
  });

  it("summarises each record's reach and lists the governable sources", () => {
    const { registry } = deriveChartResults(input);
    expect(registry).toEqual({
      stats: {
        package: { status: "active", repos: 2, trackingId: "retirement:package", successorDeprecated: false },
        exact: { status: "active", repos: 2, trackingId: "migration:exact", successorDeprecated: false },
        field: { status: "active", repos: 2, trackingId: "migration:field", successorDeprecated: true },
        absent: { status: "unseen", repos: 0, trackingId: null, successorDeprecated: false },
      },
      repoCount: 3,
      sources: [
        { packageName: "@sample/core" },
        { packageName: "@sample/mixed" },
        { packageName: "@sample/core", exportName: "ActionButton" },
        { packageName: "@sample/core", exportName: "Button" },
        { packageName: "@sample/core", exportName: "Button.Icon" },
        { packageName: "@sample/core", exportName: "sample-button" },
        { packageName: "@sample/mixed", exportName: "Field" },
      ],
    });
  });

  it("previews each saved chart against its scope and flags a repo scope with no scans", () => {
    const results = deriveChartResults(input);
    expect(Object.keys(results.previews).sort()).toEqual(dashboards.map((d) => d.id).sort());
    expect(results.previews[missingRepoDashboard.id]).toMatchObject({ missing: true });
    expect(results.previews[estateDashboard.id]?.missing).toBe(false);
    expect(results.previews[repoDashboard.id]?.missing).toBe(false);
    expect(results.previews[estateDashboard.id]?.view).toEqual({
      kind: "series",
      series: [
        { cohortKey: "tag:core", label: "core", color: "#123456", points: [{ t: DAY1, value: 3 }, { t: DAY2, value: 8 }] },
        { cohortKey: "local", label: "Local", color: "", points: [{ t: DAY1, value: 1 }, { t: DAY2, value: 2 }] },
      ],
    });

    const repoView = results.previews[repoDashboard.id]?.view;
    expect(canonical(repoView)).not.toBe(canonical(renderDashboard(repoDashboard.config, digests, tags, governance)));
    expect(repoView).toEqual({
      kind: "snapshot",
      points: [{ cohortKey: "package:@sample/core", label: "@sample/core", color: "", value: 3, componentCount: 3, role: "deprecated" }],
    });
  });
});

describe("chartResultRows", () => {
  const rows = chartResultRows(deriveChartResults(input));

  it("names keys by repo and dashboard", () => {
    expect(chartResultKey.repoTracking("repo-a")).toBe("tracking:repo:repo-a");
    expect(chartResultKey.preview("estate-trend")).toBe("preview:estate-trend");
  });

  it("yields exactly one row per key", () => {
    const keys = rows.map((r) => r.key);
    expect(keys.length).toBe(new Set(keys).size);
    expect([...keys].sort()).toEqual(
      ["tracking", "registry", ...repoIds.map(chartResultKey.repoTracking), ...dashboards.map((d) => chartResultKey.preview(d.id))].sort(),
    );
  });

  it("gives every scanned repo a tracking row, including one with nothing to track", () => {
    expect(rows.find((r) => r.key === chartResultKey.repoTracking("repo-empty"))?.payload).toEqual([]);
  });

  it("round-trips every payload through JSON unchanged", () => {
    for (const { key, payload } of rows) {
      expect(JSON.parse(JSON.stringify(payload)), key).toStrictEqual(payload);
    }
  });
});
