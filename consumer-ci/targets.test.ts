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

  test("every scan names its own token secret", () => {
    const scans = TARGETS.flatMap((t) => t.scans);
    for (const s of scans) {
      expect(s.tokenSecret, `${s.repoId} tokenSecret`).toMatch(/^SCOUTUI_TOKEN_[A-Z0-9_]+$/);
    }
    expect(new Set(scans.map((s) => s.tokenSecret)).size).toBe(scans.length);
  });

  test("every scan has a non-empty include", () => {
    for (const t of TARGETS) {
      for (const s of t.scans) {
        expect(s.include.length, `${s.repoId} include`).toBeGreaterThan(0);
      }
    }
  });

  test("ng-matero scans Angular templates and components, scriptless", () => {
    const target = TARGETS.find((t) => t.name === "ng-matero");
    expect(target?.install).toMatch(/--ignore-scripts/);
    expect(target?.scans).toMatchObject([
      { repoId: "ng-matero", include: ["src/**/*.{ts,html}"], tokenSecret: "SCOUTUI_TOKEN_NG_MATERO" },
    ]);
  });
});
