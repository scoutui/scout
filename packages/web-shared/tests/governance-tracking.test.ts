import { describe, it, expect } from "vitest";
import type { Component } from "@scoutui/scan-format";
import type { GovernanceRecord } from "../src/dto.js";
import { deriveGovernanceTracking } from "../src/governance-tracking.js";
import { artifact, component, packageExport, received, resolvedAt } from "./helpers/builders.js";

/** One scan's digest in which each component has the given number of occurrences. */
function digest(repoId: string, scannedAt: string, uses: Array<[Component, number]>) {
  return received(artifact({
    repoId,
    scanId: `${repoId}:${scannedAt}`,
    scannedAt,
    components: uses.map(([c]) => c),
    occurrences: uses.flatMap(([c, count]) => Array.from({ length: count }, (_, i) => resolvedAt(c, "src/app.tsx", i + 1))),
  }));
}

const now = "2026-01-01T00:00:00Z";
const record = (id: string, over: Partial<GovernanceRecord>): GovernanceRecord => ({
  id, grain: "component", targetPackage: "legacy-ds", targetExport: "Button",
  disposition: { kind: "superseded", by: { packageName: "@x/example-button" } },
  createdAt: now, updatedAt: now,
  ...over,
});

const btn = component(packageExport("legacy-ds", "Button"));
const util = component(packageExport("legacy-ds", "Util"));
const pb = component(packageExport("@x/example-button", "ExampleButton"));

// Two scans of r1: Button falling 10 → 4, example-button rising 2 → 6.
const scans = [
  digest("r1", "2026-01-01T00:00:00Z", [[btn, 10], [pb, 2]]),
  digest("r1", "2026-01-02T00:00:00Z", [[btn, 4], [pb, 6]]),
];

describe("deriveGovernanceTracking: migrations", () => {
  it("derives one migration per resolvable superseded record: pair config, progress, remaining, Δpp", () => {
    const [m] = deriveGovernanceTracking([record("g1", {})], scans, { kind: "all" });
    expect(m).toBeDefined();
    expect(m?.id).toBe("migration:g1");
    expect(m?.kind).toBe("migration");
    expect(m?.config).toEqual({
      scope: { kind: "all" },
      cohorts: [
        { kind: "component", componentId: btn.id },
        { kind: "package", packageName: "@x/example-button", role: "successor" },
      ],
      chartType: "trend",
      metric: "count",
    });
    expect(m?.fromLabel).toBe("Button · legacy-ds");
    expect(m?.toLabel).toBe("@x/example-button");
    expect(m?.name).toBe("Migration: Button → @x/example-button");
    expect(m?.remaining).toBe(4);
    expect(m?.active).toBe(true);
    expect(m?.progress).toBeCloseTo(6 / 10);        // succ ÷ (dep + succ) at latest scan
    expect(m?.delta).toBeCloseTo((6 / 10 - 2 / 12) * 100); // pp vs previous scan
  });

  it("display series are count-valued and role-stamped (deprecated + successor), with share as a snapshot, not a series", () => {
    const [m] = deriveGovernanceTracking([record("g1", {})], scans, { kind: "all" });
    const [dep, succ] = m?.series ?? [];
    expect(dep?.role).toBe("deprecated");
    expect(succ?.role).toBe("successor");
    expect(dep?.points.map((p) => p.value)).toEqual([10, 4]);
    expect(succ?.points.map((p) => p.value)).toEqual([2, 6]);
  });

  it("skips records that govern nothing in scope", () => {
    expect(deriveGovernanceTracking([record("g1", { targetExport: "Modal" })], scans, { kind: "all" })).toEqual([]);
  });

  it("a successor export some scan holds charts its components; one no scan holds falls back to the package", () => {
    const withExport = record("g1", { disposition: { kind: "superseded", by: { packageName: "@x/example-button", exportName: "ExampleButton" } } });
    const [m] = deriveGovernanceTracking([withExport], scans, { kind: "all" });
    expect(m?.config.cohorts[1]).toEqual({ kind: "component", componentId: pb.id, role: "successor" });
    expect(m?.toLabel).toBe("ExampleButton · @x/example-button");

    const unresolvable = record("g2", { disposition: { kind: "superseded", by: { packageName: "@x/example-button", exportName: "Nope" } } });
    const [f] = deriveGovernanceTracking([unresolvable], scans, { kind: "all" });
    expect(f?.config.cohorts[1]).toEqual({ kind: "package", packageName: "@x/example-button", role: "successor" });
  });

  it("observation window: clips leading scans where the deprecated side is unobserved", () => {
    const late = [
      digest("r2", "2026-01-01T00:00:00Z", [[pb, 3]]),
      digest("r2", "2026-01-02T00:00:00Z", [[btn, 8], [pb, 3]]),
    ];
    const [m] = deriveGovernanceTracking([record("g1", {})], late, { kind: "all" });
    // Without the clip the first point reads a fictitious "100% migrated".
    expect(m?.series[0]?.points).toHaveLength(1);
    expect(m?.series[0]?.points[0]?.t).toBe("2026-01-02T00:00:00Z");
  });

  it("repo scope: filters digests and skips records not present in that repo", () => {
    const mixed = [...scans, digest("r9", "2026-01-01T00:00:00Z", [[component(packageExport("elsewhere", "Other")), 5]])];
    const inR1 = deriveGovernanceTracking([record("g1", {})], mixed, { kind: "repo", repoId: "r1" });
    expect(inR1).toHaveLength(1);
    expect(inR1[0]?.config.scope).toEqual({ kind: "repo", repoId: "r1" });
    expect(deriveGovernanceTracking([record("g1", {})], mixed, { kind: "repo", repoId: "r9" })).toEqual([]);
  });

  it("package-grain deprecated side becomes a package cohort", () => {
    const pkgGrain = record("g1", { grain: "package", targetExport: null });
    const [m] = deriveGovernanceTracking([pkgGrain], scans, { kind: "all" });
    expect(m?.config.cohorts[0]).toEqual({ kind: "package", packageName: "legacy-ds" });
    expect(m?.fromLabel).toBe("legacy-ds");
  });

  it("finished migration: active false, remaining 0", () => {
    const done = [
      digest("r1", "2026-01-01T00:00:00Z", [[btn, 3], [pb, 5]]),
      digest("r1", "2026-01-02T00:00:00Z", [[btn, 0], [pb, 9]]),
    ];
    const [m] = deriveGovernanceTracking([record("g1", {})], done, { kind: "all" });
    expect(m?.active).toBe(false);
    expect(m?.remaining).toBe(0);
  });
});

describe("deriveGovernanceTracking: retirements", () => {
  const retired = record("g5", { targetExport: "Util", disposition: { kind: "retired", reason: "no successor" } });
  const utilScans = [
    digest("r1", "2026-01-01T00:00:00Z", [[util, 833]]),
    digest("r1", "2026-01-02T00:00:00Z", [[util, 821]]),
  ];

  it("retired records track as retirements: single red count-trend, remaining + Δ count, no percent", () => {
    const [r] = deriveGovernanceTracking([retired], utilScans, { kind: "all" });
    expect(r?.id).toBe("retirement:g5");
    expect(r?.kind).toBe("retirement");
    expect(r?.config).toEqual({
      scope: { kind: "all" },
      cohorts: [{ kind: "component", componentId: util.id }],
      chartType: "trend",
      metric: "count",
    });
    expect(r?.toLabel).toBeNull();
    expect(r?.name).toBe("Retirement: Util");
    expect(r?.progress).toBeNull();
    expect(r?.remaining).toBe(821);
    expect(r?.delta).toBe(-12);
    expect(r?.series[0]?.role).toBe("deprecated");
    expect(r?.series[0]?.points.map((p) => p.value)).toEqual([833, 821]);
  });
});

describe("deriveGovernanceTracking: ordering", () => {
  it("sorts by remaining desc (most work first)", () => {
    const two = [
      record("small", { targetExport: "Button" }),
      record("big", { targetExport: "Util", disposition: { kind: "retired", reason: "x" } }),
    ];
    const both = [digest("r1", "2026-01-02T00:00:00Z", [[btn, 4], [util, 821], [pb, 6]])];
    const out = deriveGovernanceTracking(two, both, { kind: "all" });
    expect(out.map((t) => t.id)).toEqual(["retirement:big", "migration:small"]);
  });
});

describe("deriveGovernanceTracking: per-digest-set memo", () => {
  // The derivation is memoised on the digest array's identity, so everything else
  // it reads has to be part of the inner key, or an edit to it is served a stale result.

  it("recomputes when the governance records change under the same digest array", () => {
    const before = deriveGovernanceTracking([record("g1", {})], scans, { kind: "all" });
    expect(before.map((t) => t.id)).toEqual(["migration:g1"]);

    // Same `scans` reference, different records: a renamed record and a second one.
    const after = deriveGovernanceTracking(
      [record("g1", {}), record("g2", { grain: "package", targetExport: null })],
      scans, { kind: "all" },
    );
    expect(after.map((t) => t.id).sort()).toEqual(["migration:g1", "migration:g2"]);
  });

  it("recomputes when a record's disposition changes from superseded to retired", () => {
    const superseded = deriveGovernanceTracking([record("g1", {})], scans, { kind: "all" });
    expect(superseded[0]?.kind).toBe("migration");

    const retired = deriveGovernanceTracking(
      [record("g1", { disposition: { kind: "retired", reason: "gone" } })], scans, { kind: "all" },
    );
    // A stale memo would hand back the migration entry for the same digests.
    expect(retired[0]?.kind).toBe("retirement");
    expect(retired[0]?.id).toBe("retirement:g1");
  });

  it("returns equal results for two digest arrays with equal content", () => {
    // Identity keying must not mean content-equal inputs disagree.
    const copy = scans.map((s) => ({ ...s }));
    expect(deriveGovernanceTracking([record("g1", {})], copy, { kind: "all" }))
      .toEqual(deriveGovernanceTracking([record("g1", {})], scans, { kind: "all" }));
  });
});
