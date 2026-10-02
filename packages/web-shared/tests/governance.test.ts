import { describe, it, expect } from "vitest";
import type { Component, TagAttribution } from "@scoutui/scan-format";
import { resolveGovernance, governingRecord, isDeprecated, governanceHash, componentDeprecated, governedComponentIds, listGovernanceTargets } from "../src/governance.js";
import type { GovernanceRecord } from "../src/dto.js";
import { artifact, component, packageExport, received, repoDeclaration, resolvedAt, tag } from "./helpers/builders.js";

const rec = (o: Partial<GovernanceRecord>): GovernanceRecord => ({
  id: "x", grain: "component", targetPackage: "@legacy/ui", targetExport: "Button",
  disposition: { kind: "retired", reason: "tbd" }, createdAt: "t", updatedAt: "t", ...o,
});
const lookup = (packageName: string, name: string | null) => ({ packageName, name });

describe("resolveGovernance", () => {
  it("an ungovernable lookup is always active", () => {
    expect(resolveGovernance(null, [rec({})])).toEqual({ status: "active" });
  });
  it("no matching record is active", () => {
    expect(resolveGovernance(lookup("@legacy/ui", "Card"), [rec({})])).toEqual({ status: "active" });
  });
  it("component-grain superseded resolves with the by-target", () => {
    const r = rec({ disposition: { kind: "superseded", by: { packageName: "@example/ui", exportName: "WebButton" } } });
    expect(resolveGovernance(lookup("@legacy/ui", "Button"), [r])).toEqual({
      status: "superseded", by: { packageName: "@example/ui", exportName: "WebButton" },
    });
  });
  it("component-grain wins over package-grain", () => {
    const pkg = rec({ grain: "package", targetExport: null, disposition: { kind: "superseded", by: { packageName: "@example/ui" } } });
    const comp = rec({ disposition: { kind: "retired", reason: "css" } });
    expect(resolveGovernance(lookup("@legacy/ui", "Button"), [pkg, comp])).toEqual({ status: "retired", reason: "css" });
  });
  it("package-grain cascades to a component with a package-pointer by-target", () => {
    const pkg = rec({ grain: "package", targetPackage: "@legacy/icons", targetExport: null, disposition: { kind: "superseded", by: { packageName: "@example/icons" } } });
    expect(resolveGovernance(lookup("@legacy/icons", "StarIcon"), [pkg])).toEqual({
      status: "superseded", by: { packageName: "@example/icons" },
    });
  });
});

describe("isDeprecated", () => {
  it("active is not deprecated; everything else is", () => {
    expect(isDeprecated({ status: "active" })).toBe(false);
    expect(isDeprecated({ status: "superseded", by: { packageName: "@example/ui" } })).toBe(true);
    expect(isDeprecated({ status: "retired", reason: "css" })).toBe(true);
  });
});

describe("governanceHash", () => {
  it("is order-independent and changes on edit", () => {
    const a = rec({ id: "1" });
    const b = rec({ id: "2", targetExport: "Card" });
    expect(governanceHash([a, b])).toBe(governanceHash([b, a]));
    expect(governanceHash([a])).not.toBe(governanceHash([{ ...a, updatedAt: "later" }]));
  });
  it("empty set is the sentinel", () => {
    expect(governanceHash([])).toBe("-");
  });
});

describe("componentDeprecated", () => {
  const retiredPkg: GovernanceRecord[] = [
    rec({ id: "g1", grain: "package", targetPackage: "@x/old", targetExport: null, disposition: { kind: "retired", reason: "legacy" } }),
  ];

  it("is true for an export of a retired package", () => {
    expect(componentDeprecated(component(packageExport("@x/old", "Foo")), retiredPkg)).toBe(true);
  });
  it("is false for an export of an unmanaged package", () => {
    expect(componentDeprecated(component(packageExport("@x/new", "Foo")), retiredPkg)).toBe(false);
  });
  it("is false for a repository declaration", () => {
    expect(componentDeprecated(component(repoDeclaration("r1", "src/foo.tsx", "Foo")), retiredPkg)).toBe(false);
  });
});

describe("listGovernanceTargets", () => {
  const resolvedTo = (packageName: string): TagAttribution => ({ status: "resolved", target: { kind: "package", packageName }, confidence: "observed", evidence: [] });
  const scan = (repoId: string, scanId: string, components: Component[]) =>
    received(artifact({ repoId, scanId, scannedAt: "2026-01-01T00:00:00Z", components, occurrences: [] }));
  const used = (repoId: string, scanId: string, scannedAt: string, uses: Array<[Component, number]>, arrivedAt?: string) =>
    received(artifact({
      repoId, scanId, scannedAt,
      components: uses.map(([c]) => c),
      occurrences: uses.flatMap(([c, n]) => Array.from({ length: n }, (_, i) => resolvedAt(c, "src/app.tsx", i + 1))),
    }), arrivedAt);

  it("counts each target's occurrences in each repo's latest scan, a package summing its components", () => {
    const button = component(packageExport("legacy-ds", "Button"));
    const card = component(packageExport("legacy-ds", "Card"));
    const scans = [
      used("r1", "r1:new", "2026-02-01T00:00:00Z", [[button, 2], [card, 1]]),
      used("r1", "r1:old", "2026-01-01T00:00:00Z", [[button, 5]]),
      used("r2", "r2:s1", "2026-01-15T00:00:00Z", [[button, 3]]),
    ];
    expect(listGovernanceTargets(scans)).toEqual([
      { packageName: "legacy-ds", occurrences: 6 },
      { packageName: "legacy-ds", exportName: "Button", occurrences: 5 },
      { packageName: "legacy-ds", exportName: "Card", occurrences: 1 },
    ]);
  });

  it("takes a repo's latest scan by its place in history, not by arrival or commit date alone", () => {
    const button = component(packageExport("legacy-ds", "Button"));
    // Committed in the future but received first: it sits at its arrival, before r1:feb.
    const scans = [
      used("r1", "r1:future", "2026-03-01T00:00:00Z", [[button, 9]], "2026-01-10T00:00:00Z"),
      used("r1", "r1:feb", "2026-02-01T00:00:00Z", [[button, 4]]),
    ];
    expect(listGovernanceTargets(scans)).toContainEqual({ packageName: "legacy-ds", exportName: "Button", occurrences: 4 });
  });

  it("keeps a target that only older scans have, with no occurrences", () => {
    const button = component(packageExport("legacy-ds", "Button"));
    const card = component(packageExport("legacy-ds", "Card"));
    const scans = [
      used("r1", "r1:old", "2026-01-01T00:00:00Z", [[button, 5]]),
      used("r1", "r1:new", "2026-02-01T00:00:00Z", [[card, 1]]),
    ];
    expect(listGovernanceTargets(scans)).toContainEqual({ packageName: "legacy-ds", exportName: "Button", occurrences: 0 });
  });

  it("offers a tag under the package a scan resolves it to, and that target governs it", () => {
    const text = component(tag("legacy-text"), { attribution: resolvedTo("legacy-ds") });
    const s = scan("r1", "r1:s1", [text]);
    expect(listGovernanceTargets([s])).toContainEqual(expect.objectContaining({ packageName: "legacy-ds", exportName: "legacy-text" }));
    // The seams must agree: what the picker offers must govern a real component.
    const textRule = rec({ targetPackage: "legacy-ds", targetExport: "legacy-text" });
    expect(governedComponentIds(textRule, s, [textRule])).toEqual(new Set([text.id]));
  });

  it("includes a package-grain entry for every package", () => {
    const scans = [scan("r1", "r1:s1", [component(packageExport("legacy-ds", "Button"))])];
    expect(listGovernanceTargets(scans)).toContainEqual({ packageName: "legacy-ds", occurrences: 0 });
  });

  it("excludes repository declarations and tags no scan attributes to a package", () => {
    const scans = [
      scan("r1", "r1:s1", [
        component(repoDeclaration("r1", "src/local.tsx", "Local"), { owningPackage: "app-ui" }),
        component(tag("x-orphan"), { attribution: { status: "unknown", reason: "absent", evidence: [] } }),
      ]),
    ];
    expect(listGovernanceTargets(scans)).toEqual([]);
  });

  it("dedups identities seen across repos and scans", () => {
    const scans = [
      scan("r1", "r1:s1", [component(packageExport("legacy-ds", "Button"))]),
      scan("r2", "r2:s1", [component(packageExport("legacy-ds", "Button"))]),
    ];
    const targets = listGovernanceTargets(scans);
    expect(targets.filter((t) => t.exportName === "Button")).toHaveLength(1);
    expect(targets.filter((t) => t.exportName === undefined)).toHaveLength(1);
  });

  it("is deterministic regardless of scan order", () => {
    const a = scan("r1", "r1:s1", [component(packageExport("b-pkg", "Button"))]);
    const b = scan("r2", "r2:s1", [component(packageExport("a-pkg", "Card"))]);
    expect(listGovernanceTargets([a, b])).toEqual(listGovernanceTargets([b, a]));
  });
});

describe("governingRecord: compound root grain", () => {
  const dialog = rec({ id: "dialog", targetExport: "Dialog", disposition: { kind: "retired", reason: "family" } });
  const popup = rec({ id: "popup", targetExport: "Dialog.Popup", disposition: { kind: "retired", reason: "member" } });
  const pkg = rec({ id: "pkg", grain: "package", targetExport: null, disposition: { kind: "retired", reason: "package" } });

  it("a record on the root governs every member", () => {
    expect(governingRecord(lookup("@legacy/ui", "Dialog.Popup"), [dialog])?.id).toBe("dialog");
    expect(governingRecord(lookup("@legacy/ui", "Dialog.Panel.Title"), [dialog])?.id).toBe("dialog");
    expect(resolveGovernance(lookup("@legacy/ui", "Dialog.Close"), [dialog])).toEqual({ status: "retired", reason: "family" });
  });

  it("an exact member record wins over the root record", () => {
    expect(governingRecord(lookup("@legacy/ui", "Dialog.Popup"), [dialog, popup])?.id).toBe("popup");
    expect(governingRecord(lookup("@legacy/ui", "Dialog.Close"), [dialog, popup])?.id).toBe("dialog");
  });

  it("the root record wins over the package record; the package record still cascades when there is no root", () => {
    expect(governingRecord(lookup("@legacy/ui", "Dialog.Popup"), [pkg, dialog])?.id).toBe("dialog");
    expect(governingRecord(lookup("@legacy/ui", "Popover.Panel"), [pkg, dialog])?.id).toBe("pkg");
  });

  it("a non-compound export never matches through the root grain", () => {
    expect(governingRecord(lookup("@legacy/ui", "Popup"), [popup])).toBeNull();
    expect(governingRecord(lookup("@legacy/ui", "Dialog"), [popup])).toBeNull();
    expect(governingRecord(lookup("@legacy/ui", null), [dialog])).toBeNull();
  });
});
