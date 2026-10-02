import { describe, it, expect, vi } from "vitest";

// governance-manager.tsx imports the server actions, which pull in next-auth,
// and next-auth does not resolve under vitest.
vi.mock("@/app/governance/governance-actions", () => ({
  saveGovernance: vi.fn(async () => ({ ok: true })),
  deleteGovernance: vi.fn(async () => ({ ok: true })),
}));

import { matchesRecordQuery } from "@/components/governance/governance-manager";
import type { GovernanceRecord } from "@scoutui/web-shared";

const rec = (o: Partial<GovernanceRecord>): GovernanceRecord => ({
  id: "r1", grain: "component", targetPackage: "@legacy/ui", targetExport: "Button",
  disposition: { kind: "superseded", by: { packageName: "@new/ui", exportName: "WebButton" } },
  createdAt: "t", updatedAt: "t", ...o,
});

describe("matchesRecordQuery", () => {
  it("matches everything on an empty query", () => {
    expect(matchesRecordQuery(rec({}), "")).toBe(true);
    expect(matchesRecordQuery(rec({}), "   ")).toBe(true);
  });
  it("matches the export name, case-insensitively", () => {
    // Retired disposition so the export is the only field containing "button";
    // the default successor ("WebButton") would also satisfy these queries.
    const r = rec({ disposition: { kind: "retired", reason: "no replacement" } });
    expect(matchesRecordQuery(r, "butt")).toBe(true);
    expect(matchesRecordQuery(r, "BUTTON")).toBe(true);
  });
  it("matches the package name", () => {
    expect(matchesRecordQuery(rec({}), "legacy")).toBe(true);
  });
  it("matches the successor", () => {
    expect(matchesRecordQuery(rec({}), "webbutton")).toBe(true);
  });
  it("matches the retirement reason", () => {
    expect(matchesRecordQuery(rec({ disposition: { kind: "retired", reason: "CSS rewrite" } }), "rewrite")).toBe(true);
  });
  it("does not match unrelated text", () => {
    expect(matchesRecordQuery(rec({}), "zzz")).toBe(false);
  });
  it("matches a package-grain record with a null export", () => {
    // Retired here too: the default successor ("WebButton") contains "button",
    // so the second assertion would pass on the successor instead.
    const pkg = rec({
      grain: "package",
      targetExport: null,
      disposition: { kind: "retired", reason: "no replacement" },
    });
    expect(matchesRecordQuery(pkg, "legacy")).toBe(true);
    expect(matchesRecordQuery(pkg, "button")).toBe(false);
  });
});
