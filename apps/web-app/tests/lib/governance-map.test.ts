import { describe, expect, it } from "vitest";
import type { GovernanceRecord, RecordStat } from "@scoutui/web-shared";
import {
  buildRecordMap,
  countLabel,
  progressLabel,
  recordCountLabel,
  scopeLabel,
  statusLabel,
  successorLabel,
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
  repos: 1,
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

describe("buildRecordMap", () => {
  it("puts superseded records before retired ones, component records under their source package and package records last", () => {
    const map = buildRecordMap({ visible: all, all, stats: {}, sources });
    expect(map.map((s) => [s.kind, s.recordCount])).toEqual([["superseded", 5], ["retired", 2]]);
    const [sup, ret] = map;
    expect(sup?.groups.map((g) => (g.kind === "package" ? g.packageName : g.kind))).toEqual(["@acme/old", "whole-packages"]);
    expect(ret?.groups.map((g) => (g.kind === "package" ? g.packageName : g.kind))).toEqual(["@acme/old", "whole-packages"]);
  });

  it("gives a source package its own group even with a single record", () => {
    const map = buildRecordMap({ visible: [toast], all, stats: {}, sources });
    expect(map).toHaveLength(1);
    expect(map[0]?.groups[0]).toMatchObject({ kind: "package", packageName: "@acme/old" });
    expect(map[0]?.groups[0]?.rows.map((r) => r.record.id)).toEqual(["t"]);
  });

  it("leaves out a section with no visible records", () => {
    expect(buildRecordMap({ visible: [button], all, stats: {}, sources }).map((s) => s.kind)).toEqual(["superseded"]);
  });

  it("orders rows never matched, then in progress, then complete, then no status, by name within each", () => {
    const stats = { b: stat("complete"), g: stat("active"), f: stat("unseen"), i: stat("active") };
    const extra = rec("z", "@acme/old", "Avatar", by("@acme/new", "Avatar"));
    const map = buildRecordMap({ visible: [button, badge, field, input, extra], all, stats, sources });
    expect(map[0]?.groups[0]?.rows.map((r) => r.record.targetExport)).toEqual(["TextField", "Badge", "Input", "Button", "Avatar"]);
  });

  it("counts a group's progress from its rows' stats, ignoring rows with none", () => {
    const stats = { b: stat("complete"), g: stat("active"), f: stat("unseen") };
    const group = buildRecordMap({ visible: all, all, stats, sources })[0]?.groups[0];
    expect(group?.progress).toEqual({ inProgress: 1, complete: 1, unseen: 1 });
  });

  it("counts a package record's scanned components, de-duplicated, or null when no scan has any", () => {
    const map = buildRecordMap({ visible: all, all, stats: {}, sources });
    const whole = (i: number) => map[i]?.groups.find((g) => g.kind === "whole-packages")?.rows[0]?.componentCount;
    expect(whole(0)).toBe(2);
    expect(whole(1)).toBeNull();
  });

  const flagged = (id: string) => ({ [id]: stat("active", { successorDeprecated: true }) });
  it.each([
    ["the successor component is itself superseded", field, all, flagged("f"), { packageName: "@acme/new", exportName: "Input" }],
    ["the successor component is retired", field, [field, rec("i", "@acme/old", "Input", retired("Gone."))], flagged("f"), null],
    ["the successor isn't flagged as deprecated", field, all, { f: stat("active") }, null],
    ["the successor package is itself superseded", icons, [icons, rec("n", "new-icons", null, by("newer-icons"))], flagged("p"), { packageName: "newer-icons" }],
    ["the successor package is retired", icons, [icons, rec("n", "new-icons", null, retired("Gone."))], flagged("p"), null],
  ])("nextHop when %s", (_, record, records, stats, expected) => {
    const row = buildRecordMap({ visible: [record], all: records, stats, sources })[0]?.groups[0]?.rows[0];
    expect(row?.nextHop).toEqual(expected);
  });
});

describe("wording", () => {
  it.each([
    [undefined, 3, null],
    [stat("unseen"), 3, "Never matched a scan"],
    [stat("complete", { repos: 0 }), 3, "Complete"],
    [stat("active", { repos: 1 }), 3, "Used in 1 repo"],
    [stat("active", { repos: 12 }), 3, "Used in 12 repos"],
    [stat("active", { repos: 1 }), 1, "In use"],
  ])("statusLabel(%o, %i) is %s", (s, repoCount, expected) => {
    expect(statusLabel(s, repoCount)).toBe(expected);
  });

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

  it.each([[null, null], [1, "1 component"], [4, "All 4 components"]])("scopeLabel(%o) is %s", (n, expected) => {
    expect(scopeLabel(n)).toBe(expected);
  });

  it.each([
    [{ packageName: "@acme/new", exportName: "Button" }, { name: "Button", packageName: "@acme/new" }],
    [{ packageName: "new-icons" }, { name: "new-icons", packageName: null }],
  ])("successorLabel(%o)", (s, expected) => {
    expect(successorLabel(s)).toEqual(expected);
  });
});
