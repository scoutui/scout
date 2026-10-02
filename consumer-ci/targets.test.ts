import { describe, expect, test } from "vitest";
import { TARGETS } from "./targets.js";

describe("TARGETS", () => {
  test("every scan has a unique repoId", () => {
    const ids = TARGETS.flatMap((t) => t.scans.map((s) => s.repoId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every target has at least one scan", () => {
    for (const t of TARGETS) {
      expect(t.scans.length).toBeGreaterThan(0);
    }
  });

  test("matrix names are unique (one CI job each)", () => {
    const names = TARGETS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every scan has a non-empty include", () => {
    for (const t of TARGETS) {
      for (const s of t.scans) {
        expect(s.include.length, `${s.repoId} include`).toBeGreaterThan(0);
      }
    }
  });
});
