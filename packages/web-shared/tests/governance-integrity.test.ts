import { describe, it, expect } from "vitest";
import {
  validateGovernanceInput,
  targetConflict,
  conflictMessage,
  successorDeprecated,
} from "../src/governance-integrity.js";
import type { GovernanceInput, GovernanceRecord } from "../src/dto.js";

const rec = (o: Partial<GovernanceRecord>): GovernanceRecord => ({
  id: "r1", grain: "component", targetPackage: "@legacy/ui", targetExport: "Button",
  disposition: { kind: "superseded", by: { packageName: "@new/ui", exportName: "Button" } },
  createdAt: "t", updatedAt: "t", ...o,
});

const input = (o: Partial<GovernanceInput>): GovernanceInput => ({
  grain: "component", targetPackage: "@legacy/ui", targetExport: "Card",
  disposition: { kind: "retired", reason: "gone" }, ...o,
});

describe("validateGovernanceInput", () => {
  it("accepts a record on an ungoverned target", () => {
    expect(validateGovernanceInput(input({}), [rec({})])).toBeNull();
  });

  it("accepts a package record that names no component", () => {
    expect(validateGovernanceInput(input({ grain: "package", targetExport: null }), [])).toBeNull();
  });

  it.each([
    ["no target package", input({ targetPackage: " " }), "targetPackage"],
    ["a component record that names no component", input({ targetExport: null }), "targetExport"],
    ["a package record that names a component", input({ grain: "package", targetExport: "Card" }), "targetExport"],
    ["a superseded record with no successor", input({ disposition: { kind: "superseded", by: { packageName: "" } } }), "successor"],
    ["a retired record with no reason", input({ disposition: { kind: "retired", reason: " " } }), "reason"],
  ] as const)("rejects %s", (_case, save, field) => {
    expect(validateGovernanceInput(save, [])).toEqual({ kind: "invalid_field", field });
  });

  it("rejects a new record on an already-governed target", () => {
    const existing = rec({ id: "other" });
    expect(validateGovernanceInput(input({ targetExport: "Button" }), [existing])).toEqual({
      kind: "target_governed", existingId: "other",
    });
  });

  it("lets a record edit its own target", () => {
    const existing = rec({ id: "mine" });
    const edit = input({ id: "mine", targetExport: "Button" });
    expect(validateGovernanceInput(edit, [existing])).toBeNull();
  });

  it("rejects an edit retargeted onto another record's target", () => {
    const mine = rec({ id: "mine", targetExport: "Card" });
    const theirs = rec({ id: "theirs", targetExport: "Button" });
    const edit = input({ id: "mine", targetExport: "Button" });
    expect(validateGovernanceInput(edit, [mine, theirs])).toEqual({
      kind: "target_governed", existingId: "theirs",
    });
  });

  it("rejects self-supersession at component grain", () => {
    const self = input({
      targetExport: "Button",
      disposition: { kind: "superseded", by: { packageName: "@legacy/ui", exportName: "Button" } },
    });
    expect(validateGovernanceInput(self, [])).toEqual({ kind: "self_supersession" });
  });

  it("rejects self-supersession at package grain", () => {
    const self = input({
      grain: "package", targetExport: null,
      disposition: { kind: "superseded", by: { packageName: "@legacy/ui" } },
    });
    expect(validateGovernanceInput(self, [])).toEqual({ kind: "self_supersession" });
  });

  it("rejects a cycle A->B->A", () => {
    // Existing: B is superseded by A. New: A superseded by B closes the loop.
    const bToA = rec({
      id: "b", targetPackage: "@mid/ui", targetExport: "Button",
      disposition: { kind: "superseded", by: { packageName: "@legacy/ui", exportName: "Button" } },
    });
    const aToB = input({
      targetExport: "Button",
      disposition: { kind: "superseded", by: { packageName: "@mid/ui", exportName: "Button" } },
    });
    expect(validateGovernanceInput(aToB, [bToA])).toEqual({ kind: "cycle", via: "@mid/ui/Button" });
  });

  it("allows a chain A->B->C", () => {
    const bToC = rec({
      id: "b", targetPackage: "@mid/ui", targetExport: "Button",
      disposition: { kind: "superseded", by: { packageName: "@new/ui", exportName: "Button" } },
    });
    const aToB = input({
      targetExport: "Button",
      disposition: { kind: "superseded", by: { packageName: "@mid/ui", exportName: "Button" } },
    });
    expect(validateGovernanceInput(aToB, [bToC])).toBeNull();
  });

  it("blocks a component record under an existing package-grain record", () => {
    const pkg = rec({ id: "p", grain: "package", targetExport: null });
    expect(validateGovernanceInput(input({ targetExport: "Card" }), [pkg])).toEqual({
      kind: "package_grain_overlap", existingId: "p", packageName: "@legacy/ui",
    });
  });

  it("blocks a package record over existing component records", () => {
    const a = rec({ id: "c1", targetExport: "Button" });
    const b = rec({ id: "c2", targetExport: "Card" });
    const pkg = input({ grain: "package", targetExport: null });
    expect(validateGovernanceInput(pkg, [a, b])).toEqual({
      kind: "component_grain_overlap", existingIds: ["c1", "c2"], packageName: "@legacy/ui",
    });
  });

  it("grain overlap ignores other packages", () => {
    const elsewhere = rec({ id: "x", grain: "package", targetPackage: "@other/ui", targetExport: null });
    expect(validateGovernanceInput(input({}), [elsewhere])).toBeNull();
  });

  it("reports a cycle ahead of a grain overlap", () => {
    const a = rec({
      id: "a", targetPackage: "@example/ui", targetExport: "Button",
      disposition: { kind: "superseded", by: { packageName: "@example/next", exportName: "Card" } },
    });
    const b = rec({
      id: "b", grain: "package", targetPackage: "@example/next", targetExport: null,
      disposition: { kind: "retired", reason: "gone" },
    });
    const save = input({
      targetPackage: "@example/next", targetExport: "Card",
      disposition: { kind: "superseded", by: { packageName: "@example/ui", exportName: "Button" } },
    });
    expect(validateGovernanceInput(save, [a, b])).toEqual({ kind: "cycle", via: "@example/ui/Button" });
  });
});

describe("targetConflict", () => {
  it("leaves out the record being edited", () => {
    const a = rec({ id: "a", targetPackage: "@example/ui", targetExport: "Button" });
    const target = { grain: "component", targetPackage: "@example/ui", targetExport: "Button" } as const;
    expect(targetConflict(target, [a], "a")).toBeNull();
    expect(targetConflict(target, [a])).toEqual({ kind: "target_governed", existingId: "a" });
  });
});

describe("conflictMessage", () => {
  it("teaches the way out of a grain overlap", () => {
    const msg = conflictMessage({ kind: "package_grain_overlap", existingId: "p", packageName: "@legacy/ui" });
    expect(msg).toContain("@legacy/ui");
    expect(msg).toContain("already has a record for the whole package");
  });

  it("names the successor in a cycle", () => {
    expect(conflictMessage({ kind: "cycle", via: "@mid/ui/Button" })).toContain("@mid/ui/Button");
  });
});

describe("successorDeprecated", () => {
  it("is false when the successor is ungoverned", () => {
    expect(successorDeprecated(rec({}), [rec({})])).toBe(false);
  });

  it("is true when the successor is itself governed", () => {
    const source = rec({ id: "a" });
    const successorGoverned = rec({
      id: "b", targetPackage: "@new/ui", targetExport: "Button",
      disposition: { kind: "retired", reason: "dead end" },
    });
    expect(successorDeprecated(source, [source, successorGoverned])).toBe(true);
  });

  it("is true when the successor's whole package is governed", () => {
    const source = rec({ id: "a" });
    const pkgGoverned = rec({
      id: "b", grain: "package", targetPackage: "@new/ui", targetExport: null,
      disposition: { kind: "retired", reason: "sunset" },
    });
    expect(successorDeprecated(source, [source, pkgGoverned])).toBe(true);
  });

  it("is false for a retired record (no successor to chase)", () => {
    const retired = rec({ disposition: { kind: "retired", reason: "gone" } });
    expect(successorDeprecated(retired, [retired])).toBe(false);
  });
});
