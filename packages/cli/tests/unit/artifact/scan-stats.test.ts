import { describe, expect, it } from "vitest";
import type { Occurrence } from "@scoutui/scan-format";
import { buildScanStats } from "../../../src/artifact/scan-stats.js";

const at = (filePath: string, resolved: boolean): Occurrence => ({
  occurrenceId: `${filePath}-${Math.random()}`,
  resolution: resolved ? { status: "resolved", componentId: "c" } : { status: "unresolved", reason: { kind: "module-not-found" } },
  filePath, line: 1, column: 1, credit: { kind: "render" }, trace: [], props: {},
});

describe("buildScanStats", () => {
  it("counts located and resolved credits separately", () => {
    const occurrences = [at("a.tsx", true), at("a.tsx", true), at("b.tsx", true), at("b.tsx", false), at("c.tsx", false)];
    expect(buildScanStats({ filesScanned: 9, scanDurationMs: 12, components: [{}, {}], occurrences })).toEqual({
      filesScanned: 9, scanDurationMs: 12, componentCount: 2,
      occurrenceCount: 5, resolvedOccurrenceCount: 3,
    });
  });
  it("returns zeros for an empty scan", () => {
    expect(buildScanStats({ filesScanned: 0, scanDurationMs: 0, components: [], occurrences: [] })).toEqual({
      filesScanned: 0, scanDurationMs: 0, componentCount: 0,
      occurrenceCount: 0, resolvedOccurrenceCount: 0,
    });
  });
});
