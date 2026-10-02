import { describe, it, expect } from "vitest";
import type { Component } from "@scoutui/scan-format";
import type { DigestScan } from "../src/digest.js";
import type { GovernanceRecord, Tag } from "../src/dto.js";
import {
  diffDigests,
  diffForScan,
  repoDelta,
  repoDeltas,
  repoDeltaMoved,
  scanDiffMoved,
  scanDiffRowCount,
} from "../src/scan-diff.js";
import { artifact, component, packageExport, received, repoDeclaration, resolvedAt } from "./helpers/builders.js";

const lib = (exportName: string, publicEntry = "") => component(packageExport("@x/lib", exportName, publicEntry));

const A = lib("A");
const B = lib("B");
const C = lib("C");
const D = lib("D");

/** One repo's scan digest: each component with `count` resolved call sites. */
function scan(scanId: string, scannedAt: string, uses: Array<[Component, number]>, repoId = "r1"): DigestScan {
  const occurrences = uses.flatMap(([c, count]) => Array.from({ length: count }, (_, index) => resolvedAt(c, "src/App.tsx", index + 1)));
  return received(artifact({ scanId, scannedAt, repoId, components: uses.map(([c]) => c), occurrences }));
}

const retireButton: GovernanceRecord[] = [
  {
    id: "g1", grain: "component", targetPackage: "@x/lib", targetExport: "Button",
    disposition: { kind: "retired", reason: "gone" }, createdAt: "t", updatedAt: "t",
  },
];

describe("diffDigests", () => {
  const prev = scan("S1", "2026-09-01T00:00:00.000Z", [[A, 3], [B, 5], [C, 2]]);
  const cur = scan("S2", "2026-09-02T00:00:00.000Z", [[A, 3], [B, 8], [D, 1]]);

  it("marks added, removed and changed; unchanged rows are absent", () => {
    const d = diffDigests(cur, prev, [], []);
    expect(d.baselineScanId).toBe("S1");
    expect(d.baselineCommittedAt).toBe("2026-09-01T00:00:00.000Z"); // the previous scan's time, not the current one's
    expect(d.marks).toEqual({
      [B.id]: { kind: "changed", delta: 3 },
      [C.id]: { kind: "removed" },
      [D.id]: { kind: "added" },
    });
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.changed).toBe(1);
  });

  it("keys marks by component id: Button at the same public entry pairs across scans, Card only in the second is added", () => {
    const button = lib("Button");
    const card = lib("Card");
    const before = scan("S1", "2026-09-01T00:00:00.000Z", [[button, 2]]);
    const after = scan("S2", "2026-09-02T00:00:00.000Z", [[button, 2], [card, 1]]);
    const d = diffDigests(after, before, [], []);
    expect(d.marks).toEqual({ [card.id]: { kind: "added" } });
    expect({ added: d.added, removed: d.removed, changed: d.changed }).toEqual({ added: 1, removed: 0, changed: 0 });
  });

  it("carries removed rows as ghost material with the previous occurrence count", () => {
    const d = diffDigests(cur, prev, [], []);
    expect(d.removedRows).toEqual([
      {
        componentId: C.id, displayName: "C", packageName: "@x/lib", scope: "external",
        kind: "react-component", occurrenceCount: 2, deprecated: false, tags: [],
      },
    ]);
  });

  it("derives deprecated counts through governance, one per component", () => {
    const before = scan("S1", "2026-09-01T00:00:00.000Z", [[lib("Button"), 4], [lib("Button", "./legacy"), 1], [lib("Card"), 2]]);
    const after = scan("S2", "2026-09-02T00:00:00.000Z", [[lib("Card"), 2]]);
    const d = diffDigests(after, before, retireButton, []);
    expect(d.deprecatedPrev).toBe(2); // the rule governs Button at both public entries
    expect(d.deprecatedNow).toBe(0);
    expect(d.removedRows.map((r) => r.deprecated)).toEqual([true, true]);
    expect(diffDigests(after, before, [], []).deprecatedPrev).toBe(0);
  });

  it("treats an empty previous scan as everything added", () => {
    const d = diffDigests(cur, scan("S0", "2026-08-31T00:00:00.000Z", []), [], []);
    expect(d.added).toBe(3);
    expect(d.removed).toBe(0);
    expect(d.changed).toBe(0);
    expect(d.removedRows).toEqual([]);
    expect(Object.values(d.marks).every((m) => m.kind === "added")).toBe(true);
  });

  it("marks a zero-occurrence added row as added (a held-reference row), never as changed", () => {
    const held = lib("Held");
    const after = scan("S2", "2026-09-02T00:00:00.000Z", [[A, 3], [held, 0]]);
    const before = scan("S1", "2026-09-01T00:00:00.000Z", [[A, 3]]);
    expect(diffDigests(after, before, [], []).marks).toEqual({ [held.id]: { kind: "added" } });
  });

  it("resolves a removed row's tags through resolveTags: a matching package carries the TagRef, local (no package) carries none", () => {
    const forms: Tag = {
      id: "t-forms", value: "forms", category: null, color: "#000",
      rule: { glob: ["@x/forms/*"], exact: [] },
    };
    const ext = component(packageExport("@x/forms/button", "Ext"));
    const loc = component(repoDeclaration("r1", "src/Loc.tsx", "Loc"));
    const before = scan("S1", "2026-09-01T00:00:00.000Z", [[ext, 3], [loc, 2]]);
    const after = scan("S2", "2026-09-02T00:00:00.000Z", []);
    const d = diffDigests(after, before, [], [forms]);
    expect(d.removedRows.find((r) => r.componentId === ext.id)?.tags).toEqual([
      { id: "t-forms", value: "forms", category: null, color: "#000" },
    ]);
    expect(d.removedRows.find((r) => r.componentId === loc.id)?.tags).toEqual([]);
  });
});

describe("repoDelta", () => {
  it("is added, removed, changed and the signed deprecated movement", () => {
    const keep = lib("Keep");
    const before = scan("S1", "2026-09-01T00:00:00.000Z", [[lib("Button"), 4], [lib("Old"), 1], [keep, 3]]);
    const after = scan("S2", "2026-09-02T00:00:00.000Z", [[lib("New"), 1], [lib("Also"), 2], [keep, 5]]);
    expect(repoDelta(diffDigests(after, before, retireButton, []))).toEqual({ added: 2, removed: 2, changed: 1, deprecated: -1 });
  });
});

describe("diffForScan", () => {
  const s1 = scan("S1", "2026-09-01T00:00:00.000Z", [[A, 1]]);
  const s2 = scan("S2", "2026-09-02T00:00:00.000Z", [[A, 1], [B, 1]]);
  const s3 = scan("S3", "2026-09-03T00:00:00.000Z", [[B, 1]]);

  it("baselines the scan immediately before the shown scan, whatever the input order", () => {
    const d = diffForScan([s3, s1, s2], "S2", [], []);
    expect(d?.baselineScanId).toBe("S1");
    expect(d?.baselineCommittedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(d?.added).toBe(1);
    expect(diffForScan([s3, s1, s2], "S3", [], [])?.baselineScanId).toBe("S2");
  });

  it("is null on a first scan and for a scan id not in the set", () => {
    expect(diffForScan([s3, s1, s2], "S1", [], [])).toBeNull();
    expect(diffForScan([s1], "S1", [], [])).toBeNull();
    expect(diffForScan([s3, s1, s2], "nope", [], [])).toBeNull();
  });
});

describe("repoDeltas", () => {
  it("gives every repo its newest-vs-previous delta, null with a single scan", () => {
    const X = lib("X");
    const Y = lib("Y");
    const digests = [
      scan("A1", "2026-09-01T00:00:00.000Z", [[X, 1]], "rA"),
      scan("A2", "2026-09-02T00:00:00.000Z", [[X, 1], [Y, 1]], "rA"),
      scan("B1", "2026-09-01T00:00:00.000Z", [[X, 1]], "rB"),
    ];
    const m = repoDeltas(digests, [], []);
    expect(m.get("rA")).toEqual({ added: 1, removed: 0, changed: 0, deprecated: 0 });
    expect(m.get("rB")).toBeNull();
  });
});

describe("moved predicates", () => {
  it("a deprecated-only or changed-only movement counts as moved; all-zero does not", () => {
    expect(repoDeltaMoved({ added: 0, removed: 0, changed: 0, deprecated: -2 })).toBe(true);
    expect(repoDeltaMoved({ added: 0, removed: 0, changed: 18, deprecated: 0 })).toBe(true);
    expect(repoDeltaMoved({ added: 0, removed: 0, changed: 0, deprecated: 0 })).toBe(false);
    const base = { baselineScanId: "S1", baselineCommittedAt: "2026-09-01T00:00:00.000Z", marks: {}, added: 0, removed: 0, changed: 0, removedRows: [], deprecatedPrev: 16, deprecatedNow: 16 };
    expect(scanDiffMoved(base)).toBe(false);
    expect(scanDiffMoved({ ...base, deprecatedNow: 14 })).toBe(true);
    expect(scanDiffMoved({ ...base, changed: 1 })).toBe(true);
  });
});

describe("scanDiffRowCount", () => {
  it("counts every row the changed view shows (added + changed + removed); a deprecated-only move has none", () => {
    const base = { baselineScanId: "S1", baselineCommittedAt: "2026-09-01T00:00:00.000Z", marks: {}, added: 0, removed: 0, changed: 0, removedRows: [], deprecatedPrev: 16, deprecatedNow: 16 };
    expect(scanDiffRowCount({ ...base, added: 3, changed: 18, removed: 8 })).toBe(29);
    expect(scanDiffRowCount({ ...base, deprecatedNow: 14 })).toBe(0);
  });
});
