import { describe, expect, it } from "vitest";
import type { GovernanceRecord, RecordStat } from "@scoutui/web-shared";
import {
  countLabel,
  groupRecords,
  leftOf,
  leftText,
  progressLabel,
  recordCountLabel,
  recordHref,
  successorLabel,
  wholePackageLabel,
  type Left,
  type LeftText,
  type MapRow,
  type PackageGroup,
} from "@/lib/governance-map";

function rec(
  id: string,
  targetPackage: string,
  targetExport: string | null,
  disposition: GovernanceRecord["disposition"],
): GovernanceRecord {
  return {
    id,
    grain: targetExport === null ? "package" : "component",
    targetPackage,
    targetExport,
    disposition,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
const by = (packageName: string, exportName?: string) =>
  ({ kind: "superseded", by: { packageName, ...(exportName ? { exportName } : {}) } }) as const;
const retired = (reason: string) => ({ kind: "retired", reason }) as const;
const stat = (status: RecordStat["status"], extra: Partial<RecordStat> = {}): RecordStat => ({
  status,
  left: 1,
  leftIn: ["repo-a"],
  componentIds: [],
  trackingId: status === "unseen" ? null : "migration:x",
  successorDeprecated: false,
  ...extra,
});

const button = rec("b", "@acme/old", "Button", by("@acme/new", "Button"));
const badge = rec("g", "@acme/old", "Badge", by("@acme/new", "Badge"));
const field = rec("f", "@acme/old", "TextField", by("@acme/old", "Input"));
const input = rec("i", "@acme/old", "Input", by("@acme/new", "Input"));
const toast = rec("t", "@acme/old", "Toast", retired("Moves to the shell."));
const icons = rec("p", "old-icons", null, by("new-icons"));
const select = rec("s", "old-select", null, retired("Use the app's Select."));
const all = [button, badge, field, input, toast, icons, select];
const sources = [
  { packageName: "old-icons", exportName: "Star" },
  { packageName: "old-icons", exportName: "Heart" },
  { packageName: "old-icons", exportName: "Star" },
  { packageName: "old-select" },
];
const card = rec("c", "old-kit", "Card", retired("Use a panel."));
const tabs = rec("x", "old-kit", "Tabs", by("@acme/new", "Tabs"));
const complete = stat("complete", { left: 0, leftIn: [] });
const unseen = stat("unseen", { left: 0, leftIn: [] });

const rowsOf = (g: PackageGroup | undefined): MapRow[] => (g === undefined ? [] : g.kind === "whole" ? [g.row] : g.rows);

describe("groupRecords", () => {
  it("makes a whole-package record its package's only row and groups component records by source package", () => {
    const records = [button, toast, icons];
    const { groups } = groupRecords({ visible: records, all: records, stats: {}, sources });
    expect(groups.map((g) => [g.kind, g.packageName, rowsOf(g).map((r) => r.record.id)])).toEqual([
      ["components", "@acme/old", ["b", "t"]],
      ["whole", "old-icons", ["p"]],
    ]);
  });

  it("orders packages by total left, most first, then by name", () => {
    const records = [icons, button, card, tabs];
    const stats = {
      p: stat("active", { left: 5 }),
      b: stat("active", { left: 5 }),
      c: stat("active", { left: 4 }),
      x: stat("active", { left: 5 }),
    };
    const { groups } = groupRecords({ visible: records, all: records, stats, sources });
    expect(groups.map((g) => [g.packageName, g.left.kind === "count" ? g.left.n : g.left.kind])).toEqual([
      ["old-kit", 9],
      ["@acme/old", 5],
      ["old-icons", 5],
    ]);
  });

  it("orders records inside a package by left, most first, then by name", () => {
    const records = [field, badge, button, input];
    const stats = {
      f: stat("active", { left: 2 }),
      g: stat("active", { left: 5 }),
      b: stat("active", { left: 2 }),
      i: stat("active", { left: 7 }),
    };
    const { groups } = groupRecords({ visible: records, all: records, stats, sources });
    expect(rowsOf(groups[0]).map((r) => r.record.targetExport)).toEqual(["Input", "Badge", "Button", "TextField"]);
  });

  it("sorts unseen records as none left and records with no stat last", () => {
    const records = [badge, button, field, input];
    const stats = { b: unseen, f: complete, i: stat("active", { left: 2 }) };
    const { groups } = groupRecords({ visible: records, all: records, stats, sources });
    expect(rowsOf(groups[0]).map((r) => r.record.targetExport)).toEqual(["Input", "Button", "TextField", "Badge"]);
  });

  it("totals a package as the sum of its records, in the union of their repos", () => {
    const records = [button, badge];
    const stats = { b: stat("active", { left: 3, leftIn: ["b"] }), g: stat("active", { left: 2, leftIn: ["a", "b"] }) };
    const { groups } = groupRecords({ visible: records, all: records, stats, sources });
    expect(groups[0]?.left).toEqual({ kind: "count", n: 5, repos: ["a", "b"] });
  });

  it("totals a package with any record lacking a stat as no data", () => {
    const records = [button, badge];
    const { groups } = groupRecords({ visible: records, all: records, stats: { b: stat("active", { left: 3 }) }, sources });
    expect(groups[0]?.left).toEqual({ kind: "no-data" });
    expect(rowsOf(groups[0]).map((r) => leftOf(r.stat))).toEqual([
      { kind: "count", n: 3, repos: ["repo-a"] },
      { kind: "no-data" },
    ]);
  });

  it("totals a package whose records are all unseen as unseen", () => {
    const records = [button, badge, card, tabs];
    const stats = { b: unseen, g: unseen, c: unseen, x: complete };
    const { groups } = groupRecords({ visible: records, all: records, stats, sources });
    expect(groups.map((g) => [g.packageName, g.left])).toEqual([
      ["@acme/old", { kind: "unseen" }],
      ["old-kit", { kind: "count", n: 0, repos: [] }],
    ]);
  });

  it("totals and counts a package from all its records while a search shows only some", () => {
    const records = [button, badge, icons];
    const stats = {
      b: stat("active", { left: 3, leftIn: ["a"] }),
      g: stat("active", { left: 2, leftIn: ["b"] }),
      p: stat("active", { left: 4 }),
    };
    const { groups } = groupRecords({ visible: [button], all: records, stats, sources });
    expect(groups).toMatchObject([
      { kind: "components", packageName: "@acme/old", recordCount: 2, left: { kind: "count", n: 5, repos: ["a", "b"] } },
    ]);
    expect(rowsOf(groups[0]).map((r) => r.record.id)).toEqual(["b"]);
  });

  it("splits packages whose records are all complete into the complete list and counts their records", () => {
    const records = [button, badge, select, card, tabs, icons];
    const stats = { b: complete, g: stat("active", { left: 2 }), s: complete, c: complete, x: complete, p: unseen };
    const map = groupRecords({ visible: records, all: records, stats, sources });
    expect({
      groups: map.groups.map((g) => g.packageName),
      complete: map.complete.map((g) => g.packageName),
      completeRecords: map.completeRecords,
    }).toEqual({ groups: ["@acme/old", "old-icons"], complete: ["old-kit", "old-select"], completeRecords: 3 });
  });

  it("counts only the complete records a search shows", () => {
    const records = [select, card, tabs];
    const stats = { s: complete, c: complete, x: complete };
    const map = groupRecords({ visible: [card], all: records, stats, sources });
    expect([map.complete.map((g) => g.packageName), map.completeRecords]).toEqual([["old-kit"], 1]);
  });

  it("counts a package record's scanned components, de-duplicated, or null when no scan has any", () => {
    const { groups } = groupRecords({ visible: [icons, select], all, stats: {}, sources });
    expect(groups.map((g) => [g.packageName, rowsOf(g)[0]?.componentCount])).toEqual([
      ["old-icons", 2],
      ["old-select", null],
    ]);
  });

  it("links a component group's package name when any record covers a component in the latest scans", () => {
    const records = [button, badge, card, tabs];
    const stats = { b: stat("active", { componentIds: ["c1"] }), g: stat("active"), c: stat("active"), x: stat("active") };
    const { groups } = groupRecords({ visible: records, all: records, stats, sources });
    expect(groups.map((g) => [g.packageName, g.kind === "components" ? g.href : g.kind])).toEqual([
      ["@acme/old", "/packages/%40acme%2Fold"],
      ["old-kit", null],
    ]);
  });

  const flagged = (id: string) => ({ [id]: stat("active", { successorDeprecated: true }) });
  it.each([
    ["the successor component is itself superseded", field, all, flagged("f"), { packageName: "@acme/new", exportName: "Input" }],
    ["the successor component is retired", field, [field, rec("i", "@acme/old", "Input", retired("Gone."))], flagged("f"), null],
    ["the successor isn't flagged as deprecated", field, all, { f: stat("active") }, null],
    ["the successor package is itself superseded", icons, [icons, rec("n", "new-icons", null, by("newer-icons"))], flagged("p"), { packageName: "newer-icons" }],
    ["the successor package is retired", icons, [icons, rec("n", "new-icons", null, retired("Gone."))], flagged("p"), null],
  ])("nextHop when %s", (_, record, records, stats, expected) => {
    const row = rowsOf(groupRecords({ visible: [record], all: records, stats, sources }).groups[0])[0];
    expect(row?.nextHop).toEqual(expected);
  });
});

describe("leftText", () => {
  it.each<[Left, number, LeftText]>([
    [{ kind: "count", n: 17, repos: ["vue-app"] }, 3, { kind: "count", n: "17", where: "vue-app", text: "17 in vue-app" }],
    [{ kind: "count", n: 17, repos: ["vue-app"] }, 2, { kind: "count", n: "17", where: "vue-app", text: "17 in vue-app" }],
    [{ kind: "count", n: 20, repos: ["a", "b"] }, 3, { kind: "count", n: "20", where: "2 repos", text: "20 in 2 repos" }],
    [{ kind: "count", n: 1200, repos: ["a"] }, 1, { kind: "count", n: "1,200", where: null, text: "1,200" }],
    [{ kind: "count", n: 0, repos: [] }, 3, { kind: "none", text: "None left" }],
    [{ kind: "unseen" }, 3, { kind: "unseen", text: "Not in any scan" }],
    [{ kind: "no-data" }, 3, { kind: "no-data", text: "No data" }],
  ])("reads %o with %i repos scanned", (left, repoCount, expected) => {
    expect(leftText(left, repoCount)).toEqual(expected);
  });
});

describe("recordHref", () => {
  it.each<[string, GovernanceRecord, RecordStat | undefined, string | null]>([
    ["a component record covering one component", button, stat("active", { componentIds: ["id 1"] }), "/components/id%201"],
    ["a component record covering several", button, stat("active", { componentIds: ["c1", "c2"] }), "/packages/%40acme%2Fold?q=Button&deprecated=true"],
    ["a whole-package record", rec("w", "@acme/old", null, by("@acme/new")), stat("active", { componentIds: ["c1", "c2"] }), "/packages/%40acme%2Fold"],
    ["a complete record covering nothing in the latest scans", button, { ...complete, componentIds: [] }, null],
    ["a record with no stat", button, undefined, null],
  ])("links %s", (_, record, s, href) => {
    expect(recordHref(record, s)).toBe(href);
  });
});

describe("wording", () => {
  it.each([
    [{ inProgress: 5, complete: 1, unseen: 0 }, "5 in progress · 1 complete"],
    [{ inProgress: 0, complete: 6, unseen: 0 }, "6 complete"],
    [{ inProgress: 1, complete: 0, unseen: 2 }, "1 in progress · 2 never matched a scan"],
    [{ inProgress: 0, complete: 0, unseen: 0 }, ""],
  ])("progressLabel(%o) is %s", (p, expected) => {
    expect(progressLabel(p)).toBe(expected);
  });

  it.each([[1, "1 component"], [7, "7 components"]])("countLabel(%i) is %s", (n, expected) => {
    expect(countLabel(n)).toBe(expected);
  });

  it.each([[1, "1 record"], [7, "7 records"]])("recordCountLabel(%i) is %s", (n, expected) => {
    expect(recordCountLabel(n)).toBe(expected);
  });

  it.each([[7, "Whole package · 7 components"], [1, "Whole package · 1 component"], [null, "Whole package"]])(
    "wholePackageLabel(%o) is %s",
    (n, expected) => {
      expect(wholePackageLabel(n)).toBe(expected);
    },
  );

  it.each([
    [{ packageName: "@acme/new", exportName: "Button" }, { name: "Button", packageName: "@acme/new" }],
    [{ packageName: "new-icons" }, { name: "new-icons", packageName: null }],
  ])("successorLabel(%o)", (s, expected) => {
    expect(successorLabel(s)).toEqual(expected);
  });
});
