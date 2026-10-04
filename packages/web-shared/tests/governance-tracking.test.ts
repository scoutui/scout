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
const asOf = "2026-01-10T00:00:00Z";
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
  it("derives one migration per resolvable superseded record: pair config, progress, remaining and the change in what is left", () => {
    const [m] = deriveGovernanceTracking([record("g1", {})], scans, { kind: "all" }, asOf);
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
    expect(m?.delta).toBe(-6);
    expect(m?.reposAdded).toBe(0);
  });

  it("display series are count-valued and role-stamped (deprecated + successor), with share as a snapshot, not a series", () => {
    const [m] = deriveGovernanceTracking([record("g1", {})], scans, { kind: "all" }, asOf);
    const [dep, succ] = m?.series ?? [];
    expect(dep?.role).toBe("deprecated");
    expect(succ?.role).toBe("successor");
    expect(dep?.points.map((p) => p.value)).toEqual([10, 4]);
    expect(succ?.points.map((p) => p.value)).toEqual([2, 6]);
  });

  it("skips records that govern nothing in scope", () => {
    expect(deriveGovernanceTracking([record("g1", { targetExport: "Modal" })], scans, { kind: "all" }, asOf)).toEqual([]);
  });

  it("a successor export some scan holds charts its components", () => {
    const withExport = record("g1", { disposition: { kind: "superseded", by: { packageName: "@x/example-button", exportName: "ExampleButton" } } });
    const [m] = deriveGovernanceTracking([withExport], scans, { kind: "all" }, asOf);
    expect(m?.config.cohorts[1]).toEqual({ kind: "component", componentId: pb.id, role: "successor" });
    expect(m?.toLabel).toBe("ExampleButton · @x/example-button");
  });

  it.each([
    ["an export", { packageName: "@x/example-button", exportName: "Nope" }, "Nope · @x/example-button", "Migration: Button → Nope"],
    ["a package", { packageName: "@x/unused" }, "@x/unused", "Migration: Button → @x/unused"],
  ])("a successor %s no scan holds counts 0 uses under its own name", (_, by, toLabel, name) => {
    const [m] = deriveGovernanceTracking([record("g2", { disposition: { kind: "superseded", by } })], scans, { kind: "all" }, asOf);
    expect(m?.config.cohorts).toEqual([{ kind: "component", componentId: btn.id }]);
    expect(m?.toLabel).toBe(toLabel);
    expect(m?.name).toBe(name);
    expect(m?.series[1]?.points.map((p) => p.value)).toEqual([0, 0]);
    expect(m?.progress).toBe(0);
  });

  it("observation window: clips leading scans where the deprecated side is unobserved", () => {
    const late = [
      digest("r2", "2026-01-01T00:00:00Z", [[pb, 3]]),
      digest("r2", "2026-01-02T00:00:00Z", [[btn, 8], [pb, 3]]),
    ];
    const [m] = deriveGovernanceTracking([record("g1", {})], late, { kind: "all" }, asOf);
    // Without the clip the first point reads a fictitious "100% migrated".
    expect(m?.series[0]?.points).toHaveLength(1);
    expect(m?.series[0]?.points[0]?.t).toBe("2026-01-02T00:00:00Z");
    expect(m?.coverage).toEqual({ total: 1, points: [{ t: "2026-01-02T00:00:00Z", repos: 1 }] });
  });

  it("repo scope: filters digests and skips records not present in that repo", () => {
    const mixed = [...scans, digest("r9", "2026-01-01T00:00:00Z", [[component(packageExport("elsewhere", "Other")), 5]])];
    const inR1 = deriveGovernanceTracking([record("g1", {})], mixed, { kind: "repo", repoId: "r1" }, asOf);
    expect(inR1).toHaveLength(1);
    expect(inR1[0]?.config.scope).toEqual({ kind: "repo", repoId: "r1" });
    expect(deriveGovernanceTracking([record("g1", {})], mixed, { kind: "repo", repoId: "r9" }, asOf)).toEqual([]);
  });

  it("package-grain deprecated side becomes a package cohort", () => {
    const pkgGrain = record("g1", { grain: "package", targetExport: null });
    const [m] = deriveGovernanceTracking([pkgGrain], scans, { kind: "all" }, asOf);
    expect(m?.config.cohorts[0]).toEqual({ kind: "package", packageName: "legacy-ds" });
    expect(m?.fromLabel).toBe("legacy-ds");
  });

  it("finished migration: active false, remaining 0", () => {
    const done = [
      digest("r1", "2026-01-01T00:00:00Z", [[btn, 3], [pb, 5]]),
      digest("r1", "2026-01-02T00:00:00Z", [[btn, 0], [pb, 9]]),
    ];
    const [m] = deriveGovernanceTracking([record("g1", {})], done, { kind: "all" }, asOf);
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

  it("retired records track as retirements: single red count-trend, remaining and its change, no percent", () => {
    const [r] = deriveGovernanceTracking([retired], utilScans, { kind: "all" }, asOf);
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

describe("deriveGovernanceTracking: change over the last 30 days", () => {
  const march = "2026-03-01T00:00:00Z";
  const g1 = record("g1", {});

  it("compares each repo's latest scan with its latest scan on or before the window's start", () => {
    const history = [
      digest("r1", "2026-01-01T00:00:00Z", [[btn, 40], [pb, 1]]),
      digest("r1", "2026-01-20T00:00:00Z", [[btn, 30], [pb, 2]]),
      digest("r1", "2026-02-20T00:00:00Z", [[btn, 24], [pb, 8]]),
    ];
    const [m] = deriveGovernanceTracking([g1], history, { kind: "all" }, march);
    expect(m?.delta).toBe(-6);
    expect(m?.reposAdded).toBe(0);
  });

  it("does not move when only the replacement's uses change", () => {
    const deleted = [
      digest("r1", "2026-01-20T00:00:00Z", [[btn, 17], [pb, 8]]),
      digest("r1", "2026-02-20T00:00:00Z", [[btn, 17], [pb, 5]]),
    ];
    const [m] = deriveGovernanceTracking([g1], deleted, { kind: "all" }, march);
    expect(m?.delta).toBe(0);
  });

  it("counts a repo that joined inside the window from its first scan, and says it was added", () => {
    const joined = [
      digest("r1", "2026-01-20T00:00:00Z", [[btn, 30]]),
      digest("r1", "2026-02-20T00:00:00Z", [[btn, 24]]),
      digest("r2", "2026-02-10T00:00:00Z", [[btn, 4]]),
      digest("r2", "2026-02-25T00:00:00Z", [[btn, 3]]),
    ];
    const [m] = deriveGovernanceTracking([g1], joined, { kind: "all" }, march);
    expect(m?.delta).toBe(-7);
    expect(m?.reposAdded).toBe(1);
  });

  it("does not count a joined repo as added when its latest scan has no old uses", () => {
    const joined = [
      digest("r1", "2026-01-20T00:00:00Z", [[btn, 30]]),
      digest("r1", "2026-02-20T00:00:00Z", [[btn, 24]]),
      digest("r2", "2026-02-10T00:00:00Z", [[pb, 4]]),
    ];
    expect(deriveGovernanceTracking([g1], joined, { kind: "all" }, march)[0]?.reposAdded).toBe(0);
  });

  it("adds no repo in the first month, when no repo has a scan before the window", () => {
    const firstMonth = [
      digest("r1", "2026-02-05T00:00:00Z", [[btn, 30]]),
      digest("r1", "2026-02-20T00:00:00Z", [[btn, 24]]),
      digest("r2", "2026-02-10T00:00:00Z", [[btn, 4]]),
    ];
    const [m] = deriveGovernanceTracking([g1], firstMonth, { kind: "all" }, march);
    expect(m?.delta).toBe(-6);
    expect(m?.reposAdded).toBe(0);
  });

  it("counts the first use of a retired component from the scans before it appeared", () => {
    const retired = record("g5", { targetExport: "Util", disposition: { kind: "retired", reason: "gone" } });
    const appeared = [
      digest("r1", "2026-02-05T00:00:00Z", [[btn, 3]]),
      digest("r1", "2026-02-20T00:00:00Z", [[btn, 3], [util, 1]]),
    ];
    expect(deriveGovernanceTracking([retired], appeared, { kind: "all" }, march)[0]?.delta).toBe(1);
  });

  it("has no reading until some repo with old uses has two scans", () => {
    const once = [
      digest("r1", "2026-02-20T00:00:00Z", [[btn, 24]]),
      digest("r2", "2026-02-01T00:00:00Z", [[pb, 2]]),
      digest("r2", "2026-02-21T00:00:00Z", [[pb, 3]]),
    ];
    expect(deriveGovernanceTracking([g1], once, { kind: "all" }, march)[0]?.delta).toBeNull();
  });

  it("compares a repo's latest scan with its previous one under a repo scope, whatever the window", () => {
    const history = [
      digest("r1", "2025-10-01T00:00:00Z", [[btn, 10]]),
      digest("r1", "2025-11-01T00:00:00Z", [[btn, 7]]),
      digest("r1", "2025-12-01T00:00:00Z", [[btn, 4]]),
    ];
    const [m] = deriveGovernanceTracking([g1], history, { kind: "repo", repoId: "r1" }, march);
    expect(m?.delta).toBe(-3);
    expect(m?.reposAdded).toBe(0);
  });

  it("recomputes when the window's end changes under the same digest array", () => {
    const history = [
      digest("r1", "2026-01-01T00:00:00Z", [[btn, 30]]),
      digest("r1", "2026-02-20T00:00:00Z", [[btn, 24]]),
    ];
    expect(deriveGovernanceTracking([g1], history, { kind: "all" }, march)[0]?.delta).toBe(-6);
    expect(deriveGovernanceTracking([g1], history, { kind: "all" }, "2026-04-01T00:00:00Z")[0]?.delta).toBe(0);
  });
});

describe("deriveGovernanceTracking: records that share a replacement", () => {
  const card = component(packageExport("legacy-ds", "Card"));
  const cardHeader = component(packageExport("legacy-ds", "CardHeader"));
  const newCard = component(packageExport("@x/new-ds", "Card"));
  const toCard = { kind: "superseded" as const, by: { packageName: "@x/new-ds", exportName: "Card" } };
  const older = record("older", { targetExport: "CardHeader", disposition: toCard, createdAt: "2025-12-01T00:00:00Z" });
  const newer = record("newer", { targetExport: "Card", disposition: toCard });
  const cards = [
    digest("r1", "2026-01-01T00:00:00Z", [[card, 12], [cardHeader, 6], [newCard, 1]]),
    digest("r1", "2026-01-02T00:00:00Z", [[card, 10], [cardHeader, 5], [newCard, 3]]),
  ];

  it("tracks them as one migration of every part, named after the oldest record", () => {
    const out = deriveGovernanceTracking([newer, older], cards, { kind: "all" }, asOf);
    expect(out).toHaveLength(1);
    const [m] = out;
    expect(m?.id).toBe("migration:older");
    expect(m?.recordIds).toEqual(["older", "newer"]);
    expect(m?.fromLabel).toBe("Card, CardHeader · legacy-ds");
    expect(m?.toLabel).toBe("Card · @x/new-ds");
    expect(m?.name).toBe("Migration: Card, CardHeader → Card");
    expect(m?.remaining).toBe(15);
    expect(m?.progress).toBeCloseTo(3 / 18);
    expect(m?.delta).toBe(-3);
    expect(m?.series.map((s) => s.points.map((p) => p.value))).toEqual([[18, 15], [1, 3]]);
    expect(m?.config.cohorts).toEqual([
      { kind: "component", componentId: cardHeader.id },
      { kind: "component", componentId: card.id },
      { kind: "component", componentId: newCard.id, role: "successor" },
    ]);
  });

  it("keeps one row per record when the replacements differ", () => {
    const elsewhere = record("elsewhere", { targetExport: "Card", disposition: { kind: "superseded", by: { packageName: "@x/new-ds", exportName: "Panel" } } });
    expect(deriveGovernanceTracking([elsewhere, older], cards, { kind: "all" }, asOf).map((t) => t.recordIds)).toEqual([["elsewhere"], ["older"]]);
  });

  it("keeps one row per retirement", () => {
    const gone = { kind: "retired" as const, reason: "gone" };
    const retired = [record("a", { targetExport: "Card", disposition: gone }), record("b", { targetExport: "CardHeader", disposition: gone })];
    expect(deriveGovernanceTracking(retired, cards, { kind: "all" }, asOf)).toHaveLength(2);
  });

  it("counts each use once when a package record and a record for one of its components share the replacement", () => {
    const whole = record("whole", { grain: "package", targetExport: null, disposition: toCard, createdAt: "2025-12-01T00:00:00Z" });
    const [m] = deriveGovernanceTracking([whole, newer], cards, { kind: "all" }, asOf);
    expect(m?.remaining).toBe(15);
    expect(m?.fromLabel).toBe("legacy-ds");
  });

  it("names four parts, then how many more", () => {
    const parts = ["A", "B", "C", "D", "E", "F"].map((name) => component(packageExport("legacy-ds", name)));
    const records = parts.map((_, i) => record(`p${i}`, { targetExport: ["A", "B", "C", "D", "E", "F"][i] as string, disposition: toCard }));
    const scan = digest("r1", "2026-01-02T00:00:00Z", [...parts.map((c) => [c, 1] as [Component, number]), [newCard, 1]]);
    expect(deriveGovernanceTracking(records, [scan], { kind: "all" }, asOf)[0]?.fromLabel).toBe("A, B, C, D +2 more · legacy-ds");
  });
});

describe("deriveGovernanceTracking: ordering", () => {
  it("sorts by remaining desc (most work first)", () => {
    const two = [
      record("small", { targetExport: "Button" }),
      record("big", { targetExport: "Util", disposition: { kind: "retired", reason: "x" } }),
    ];
    const both = [digest("r1", "2026-01-02T00:00:00Z", [[btn, 4], [util, 821], [pb, 6]])];
    const out = deriveGovernanceTracking(two, both, { kind: "all" }, asOf);
    expect(out.map((t) => t.id)).toEqual(["retirement:big", "migration:small"]);
  });
});

describe("deriveGovernanceTracking: per-digest-set memo", () => {
  // The derivation is memoised on the digest array's identity, so everything else
  // it reads has to be part of the inner key, or an edit to it is served a stale result.

  it("recomputes when the governance records change under the same digest array", () => {
    const before = deriveGovernanceTracking([record("g1", {})], scans, { kind: "all" }, asOf);
    expect(before.map((t) => t.id)).toEqual(["migration:g1"]);

    // Same `scans` reference, different records: a renamed record and a second one.
    const after = deriveGovernanceTracking(
      [record("g1", {}), record("g2", { grain: "package", targetExport: null, disposition: { kind: "superseded", by: { packageName: "@x/other" } } })],
      scans, { kind: "all" }, asOf,
    );
    expect(after.map((t) => t.id).sort()).toEqual(["migration:g1", "migration:g2"]);
  });

  it("recomputes when a record's disposition changes from superseded to retired", () => {
    const superseded = deriveGovernanceTracking([record("g1", {})], scans, { kind: "all" }, asOf);
    expect(superseded[0]?.kind).toBe("migration");

    const retired = deriveGovernanceTracking(
      [record("g1", { disposition: { kind: "retired", reason: "gone" } })], scans, { kind: "all" }, asOf,
    );
    // A stale memo would hand back the migration entry for the same digests.
    expect(retired[0]?.kind).toBe("retirement");
    expect(retired[0]?.id).toBe("retirement:g1");
  });

  it("returns equal results for two digest arrays with equal content", () => {
    // Identity keying must not mean content-equal inputs disagree.
    const copy = scans.map((s) => ({ ...s }));
    expect(deriveGovernanceTracking([record("g1", {})], copy, { kind: "all" }, asOf))
      .toEqual(deriveGovernanceTracking([record("g1", {})], scans, { kind: "all" }, asOf));
  });
});
