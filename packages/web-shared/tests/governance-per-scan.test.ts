import { describe, expect, it } from "vitest";
import type { Component, TagAttribution } from "@scoutui/scan-format";
import type { GovernanceRecord } from "../src/dto.js";
import { governedComponentIds, listGovernanceTargets } from "../src/governance.js";
import { deriveGovernanceTracking } from "../src/governance-tracking.js";
import { renderDashboard } from "../src/dashboard-render.js";
import { artifact, component, packageExport, received, repoDeclaration, resolvedAt, tag } from "./helpers/builders.js";

const t1 = "2026-06-01T00:00:00Z";

function scanOf(repoId: string, uses: Array<[Component, number]>) {
  return received(artifact({
    repoId,
    scanId: `${repoId}:${t1}`,
    scannedAt: t1,
    components: uses.map(([c]) => c),
    occurrences: uses.flatMap(([c, count]) => Array.from({ length: count }, (_, i) => resolvedAt(c, "src/app.tsx", i + 1))),
  }));
}

const rule = (id: string, over: Partial<GovernanceRecord>): GovernanceRecord => ({
  id, grain: "component", targetPackage: "@example/ui", targetExport: "Button",
  disposition: { kind: "retired", reason: "replaced" }, createdAt: t1, updatedAt: t1, ...over,
});

const resolvedToUi: TagAttribution = { status: "resolved", target: { kind: "package", packageName: "@example/ui" }, confidence: "observed", evidence: [] };
const unknown: TagAttribution = { status: "unknown", reason: "absent", evidence: [] };

const button = component(packageExport("@example/ui", "Button"));
const buttonDist = component(packageExport("@example/ui", "Button", "dist/button"));
const cardInA = component(tag("x-card"), { attribution: resolvedToUi });
const cardInB = component(tag("x-card"), { attribution: unknown });
const localButton = component(repoDeclaration("repo-local", "src/button.tsx", "Button"), { owningPackage: "@example/ui" });

const entries = scanOf("repo-a", [[button, 2], [buttonDist, 3]]);
const scanA = scanOf("repo-card-a", [[cardInA, 1]]);
const scanB = scanOf("repo-card-b", [[cardInB, 4]]);
const localScan = scanOf("repo-local", [[localButton, 6]]);

describe("governance per scan on the scan-file identity", () => {
  it("a component rule governs the export at every public entry, and migration progress counts both", () => {
    const next = component(packageExport("@example/new-ui", "Button"));
    const scan = scanOf("repo-a", [[button, 2], [buttonDist, 3], [next, 5]]);
    const migration = rule("button", { disposition: { kind: "superseded", by: { packageName: "@example/new-ui", exportName: "Button" } } });

    expect(governedComponentIds(migration, scan, [migration])).toEqual(new Set([button.id, buttonDist.id]));
    const [entry] = deriveGovernanceTracking([migration], [scan], { kind: "all" });
    expect(entry?.remaining).toBe(5);
    expect(entry?.progress).toBe(0.5);
  });

  it("a successor export counts at every public entry", () => {
    const next = component(packageExport("@example/new-ui", "Button"));
    const nextDist = component(packageExport("@example/new-ui", "Button", "dist/button"));
    const scan = scanOf("repo-a", [[button, 2], [next, 3], [nextDist, 5]]);
    const migration = rule("button", { disposition: { kind: "superseded", by: { packageName: "@example/new-ui", exportName: "Button" } } });

    expect(deriveGovernanceTracking([migration], [scan], { kind: "all" })[0]?.progress).toBe(0.8);
  });

  it("a tag rule governs the tag only in the scan that resolves it to the rule's package", () => {
    const cardRule = rule("card", { targetExport: "x-card" });

    expect(governedComponentIds(cardRule, scanA, [cardRule])).toEqual(new Set([cardInA.id]));
    expect(governedComponentIds(cardRule, scanB, [cardRule])).toEqual(new Set());
    const [entry] = deriveGovernanceTracking([cardRule], [scanA, scanB], { kind: "all" });
    expect(entry?.remaining).toBe(1);
  });

  it("a rule on a compound root governs its members", () => {
    const popup = component(packageExport("@example/ui", "Dialog.Popup"));
    const scan = scanOf("repo-a", [[popup, 2]]);
    const dialogRule = rule("dialog", { targetExport: "Dialog" });

    expect(governedComponentIds(dialogRule, scan, [dialogRule])).toEqual(new Set([popup.id]));
    expect(deriveGovernanceTracking([dialogRule], [scan], { kind: "all" })[0]?.remaining).toBe(2);
  });

  it("charts a member with a record of its own under that record only, not also under its compound root", () => {
    const dialog = component(packageExport("@example/ui", "Dialog"));
    const popup = component(packageExport("@example/ui", "Dialog.Popup"));
    const scan = scanOf("repo-a", [[dialog, 1], [popup, 4]]);
    const records = [
      rule("dialog", { targetExport: "Dialog" }),
      rule("popup", { targetExport: "Dialog.Popup", disposition: { kind: "superseded", by: { packageName: "@example/next-ui" } } }),
    ];

    const remaining = Object.fromEntries(deriveGovernanceTracking(records, [scan], { kind: "all" }).map((t) => [t.record.id, t.remaining]));
    expect(remaining).toEqual({ dialog: 1, popup: 4 });
  });

  it("a package record charts its whole package, including a component with a record of its own", () => {
    const card = component(packageExport("@example/ui", "Card"));
    const scan = scanOf("repo-a", [[button, 2], [card, 3]]);
    const records = [rule("package", { grain: "package", targetExport: null }), rule("button", {})];

    const remaining = Object.fromEntries(deriveGovernanceTracking(records, [scan], { kind: "all" }).map((t) => [t.record.id, t.remaining]));
    expect(remaining).toEqual({ package: 5, button: 2 });
  });

  it("a successor's family takes its compound members, except those with a record of their own", () => {
    const modal = component(packageExport("@example/ui", "Modal"));
    const nextDialog = component(packageExport("@example/next-ui", "Dialog"));
    const nextClose = component(packageExport("@example/next-ui", "Dialog.Close"));
    const nextPopup = component(packageExport("@example/next-ui", "Dialog.Popup"));
    const scan = scanOf("repo-a", [[modal, 2], [nextDialog, 3], [nextClose, 1], [nextPopup, 5]]);
    const records = [
      rule("modal", { targetExport: "Modal", disposition: { kind: "superseded", by: { packageName: "@example/next-ui", exportName: "Dialog" } } }),
      rule("popup", { targetPackage: "@example/next-ui", targetExport: "Dialog.Popup" }),
    ];

    const migration = deriveGovernanceTracking(records, [scan], { kind: "all" }).find((t) => t.record.id === "modal");
    // Successor: Dialog (3) + Dialog.Close (1); Dialog.Popup belongs to its own record.
    expect(migration?.progress).toBeCloseTo(4 / 6);
  });

  it("never governs a repository declaration, even one whose workspace package is the rule's package", () => {
    const packageRule = rule("package", { grain: "package", targetExport: null });
    const buttonRule = rule("button", {});

    expect(governedComponentIds(buttonRule, localScan, [buttonRule])).toEqual(new Set());
    expect(governedComponentIds(packageRule, localScan, [packageRule])).toEqual(new Set());
  });

  it("offers each governable package and name once, and a tag only where a scan resolves it", () => {
    expect(listGovernanceTargets([entries, scanA, scanB, localScan])).toEqual([
      { packageName: "@example/ui" },
      { packageName: "@example/ui", exportName: "Button" },
      { packageName: "@example/ui", exportName: "x-card" },
    ]);
  });

  it("leaves out a component series whose id no scan holds, with or without a saved label", () => {
    const view = renderDashboard(
      {
        scope: { kind: "all" },
        cohorts: [
          { kind: "component", componentId: "v1-logical-id" },
          { kind: "component", componentId: button.id },
          { kind: "component", componentId: "v1-labelled-id", label: "Old button" },
        ],
        chartType: "table",
        metric: "count",
      },
      [entries, scanA],
      [],
    );

    expect(view).toEqual({
      kind: "table",
      points: [{ cohortKey: `component:${button.id}`, label: "Button · @example/ui", color: "", value: 2, componentCount: 1 }],
      series: [{ cohortKey: `component:${button.id}`, label: "Button · @example/ui", color: "", points: [{ t: t1, value: 2 }] }],
    });
  });
});
