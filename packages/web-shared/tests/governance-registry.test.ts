import { describe, it, expect } from "vitest";
import type { Component } from "@scoutui/scan-format";
import { deriveRecordStats } from "../src/governance-registry.js";
import type { GovernanceRecord } from "../src/dto.js";
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

const rec = (o: Partial<GovernanceRecord>): GovernanceRecord => ({
  id: "r1", grain: "component", targetPackage: "@legacy/ui", targetExport: "Button",
  disposition: { kind: "superseded", by: { packageName: "@new/ui", exportName: "Button" } },
  createdAt: "t", updatedAt: "t", ...o,
});

const btn = component(packageExport("@legacy/ui", "Button"));
const newBtn = component(packageExport("@new/ui", "Button"));

describe("deriveRecordStats", () => {
  it("reports a record whose target never scanned as unseen, with no tracking edge", () => {
    const r = rec({ targetPackage: "@ghost/ui", targetExport: "Nope" });
    const { stats } = deriveRecordStats([r], [digest("a", "2026-01-01T00:00:00Z", [[btn, 3]])]);
    expect(stats.r1).toEqual({ status: "unseen", repos: 0, trackingId: null, successorDeprecated: false });
  });

  it("reports an in-flight migration as active with a tracking edge", () => {
    const { stats } = deriveRecordStats([rec({})], [digest("a", "2026-01-01T00:00:00Z", [[btn, 3], [newBtn, 1]])]);
    expect(stats.r1?.status).toBe("active");
    expect(stats.r1?.trackingId).toBe("migration:r1");
  });

  it("counts coverage as repos whose latest scan still shows the deprecated side", () => {
    const scans = [
      digest("a", "2026-01-01T00:00:00Z", [[btn, 3]]),
      digest("b", "2026-01-01T00:00:00Z", [[newBtn, 4]]),
    ];
    const { stats, repoCount } = deriveRecordStats([rec({})], scans);
    expect(repoCount).toBe(2);
    expect(stats.r1?.repos).toBe(1);
  });

  it("reports repoCount so a one-repo estate can drop the coverage phrase", () => {
    const { repoCount } = deriveRecordStats([rec({})], [digest("a", "2026-01-01T00:00:00Z", [[btn, 1]])]);
    expect(repoCount).toBe(1);
  });

  it("flags a record whose successor is itself governed", () => {
    const source = rec({ id: "a" });
    const chained = rec({
      id: "b", targetPackage: "@new/ui", targetExport: "Button",
      disposition: { kind: "retired", reason: "dead end" },
    });
    const { stats } = deriveRecordStats([source, chained], [digest("a", "2026-01-01T00:00:00Z", [[btn, 3], [newBtn, 1]])]);
    expect(stats.a?.successorDeprecated).toBe(true);
    expect(stats.b?.successorDeprecated).toBe(false);
  });

  it("returns an entry for every record, including unseen ones", () => {
    const { stats } = deriveRecordStats(
      [rec({ id: "seen" }), rec({ id: "ghost", targetPackage: "@ghost/ui", targetExport: "X" })],
      [digest("a", "2026-01-01T00:00:00Z", [[btn, 1]])],
    );
    expect(Object.keys(stats).sort()).toEqual(["ghost", "seen"]);
  });

  it("has no repos and no scans to read in an empty estate", () => {
    const { stats, repoCount } = deriveRecordStats([rec({})], []);
    expect(repoCount).toBe(0);
    expect(stats.r1?.status).toBe("unseen");
  });

  it("reports a record whose deprecated side fell to zero after a historical match as complete, with a tracking edge", () => {
    const r = rec({ disposition: { kind: "retired", reason: "removed" } });
    const scans = [
      digest("a", "2026-01-01T00:00:00Z", [[btn, 3]]),
      digest("a", "2026-02-01T00:00:00Z", [[btn, 0]]),
    ];
    const { stats } = deriveRecordStats([r], scans);
    expect(stats.r1?.status).toBe("complete");
    expect(stats.r1?.trackingId).toBe("retirement:r1");
  });
});
