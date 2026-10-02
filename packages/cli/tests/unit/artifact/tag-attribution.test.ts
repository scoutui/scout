import { describe, expect, it } from "vitest";
import type { AttributionTarget, KnownEvidenceRecord } from "@scoutui/scan-format";
import { resolveTagAttribution } from "../../../src/artifact/tag-attribution.js";

const cardFile: AttributionTarget = { kind: "repository", repoId: "r", filePath: "src/card.ts", exportName: "Card" };
const otherFile: AttributionTarget = { kind: "repository", repoId: "r", filePath: "src/other.ts", exportName: "Other" };
const kit: AttributionTarget = { kind: "package", packageName: "@example/kit" };
const staleKit: AttributionTarget = { kind: "package", packageName: "@example/stale-kit" };

/** A record as a collector hands it over; the resolver assigns the disposition. */
const registration = (target: AttributionTarget | null, line = 3): KnownEvidenceRecord => ({
  source: "registration",
  strength: "observed",
  locator: { filePath: target?.kind === "repository" ? target.filePath : "src/anonymous.ts", line },
  ...(target !== null ? { target } : {}),
  disposition: "unresolved",
});
const cem = (target: AttributionTarget & { kind: "package" }): KnownEvidenceRecord => ({
  source: "cem",
  strength: "declared",
  locator: { packageName: target.packageName, version: "1.0.0" },
  target,
  disposition: "unresolved",
});

describe("resolveTagAttribution", () => {
  it("resolves a unique observed target with observed confidence", () => {
    expect(resolveTagAttribution([registration(cardFile)])).toEqual({
      status: "resolved",
      target: cardFile,
      confidence: "observed",
      evidence: [{ ...registration(cardFile), disposition: "supports" }],
    });
  });

  it("resolves a unique declared target with declared confidence", () => {
    expect(resolveTagAttribution([cem(kit)])).toEqual({
      status: "resolved",
      target: kit,
      confidence: "declared",
      evidence: [{ ...cem(kit), disposition: "supports" }],
    });
  });

  it("reports two observed targets as a conflict naming both as candidates", () => {
    expect(resolveTagAttribution([registration(otherFile), registration(cardFile)])).toEqual({
      status: "conflict",
      strongestClass: "observed",
      candidates: [cardFile, otherFile],
      evidence: [
        { ...registration(cardFile), disposition: "candidate" },
        { ...registration(otherFile), disposition: "candidate" },
      ],
    });
  });

  it("marks a weaker record naming a target outside the conflict as contradicting", () => {
    const attribution = resolveTagAttribution([registration(cardFile), registration(otherFile), cem(staleKit)]);
    expect(attribution.evidence.map((e) => [e.source, e.disposition])).toEqual([
      ["registration", "candidate"],
      ["registration", "candidate"],
      ["cem", "contradicts"],
    ]);
  });

  it("lets an observed target beat a declared one, which contradicts it", () => {
    expect(resolveTagAttribution([cem(staleKit), registration(cardFile)])).toEqual({
      status: "resolved",
      target: cardFile,
      confidence: "observed",
      evidence: [
        { ...registration(cardFile), disposition: "supports" },
        { ...cem(staleKit), disposition: "contradicts" },
      ],
    });
  });

  it("is unknown and absent with no evidence", () => {
    expect(resolveTagAttribution([])).toEqual({ status: "unknown", reason: "absent", evidence: [] });
  });

  it("is unknown and unresolved when no record carries a target", () => {
    expect(resolveTagAttribution([registration(null)])).toEqual({
      status: "unknown",
      reason: "unresolved",
      evidence: [{ ...registration(null), disposition: "unresolved" }],
    });
  });

  it("marks a targetless record unresolved beside a resolved target", () => {
    const attribution = resolveTagAttribution([registration(null), cem(kit)]);
    expect(attribution).toMatchObject({ status: "resolved", target: kit, confidence: "declared" });
    expect(attribution.evidence.map((e) => [e.source, e.disposition])).toEqual([
      ["registration", "unresolved"],
      ["cem", "supports"],
    ]);
  });

  it("orders one file's records by line number", () => {
    const lines = resolveTagAttribution([registration(cardFile, 12), registration(cardFile, 3)]).evidence.map(
      (e) => "line" in e.locator && e.locator.line,
    );
    expect(lines).toEqual([3, 12]);
  });

  it("never depends on input order", () => {
    const records = [
      registration(cardFile, 3),
      registration(otherFile, 9),
      registration(null, 1),
      cem(kit),
      cem(staleKit),
      registration(cardFile, 12),
    ];
    const expected = resolveTagAttribution(records);
    for (let seed = 1; seed <= 20; seed++) {
      expect(resolveTagAttribution(shuffle(records, seed))).toEqual(expected);
    }
  });
});

/** A deterministic Fisher-Yates shuffle. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
