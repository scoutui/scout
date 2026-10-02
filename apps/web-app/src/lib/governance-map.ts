import type { GovernanceRecord, RecordStat } from "@scoutui/web-shared";
import { resolveGovernance } from "@scoutui/web-shared/client";
import { packageComponentFiltersToParams } from "@/lib/package-facets";
import { hrefWithQuery } from "@/lib/query-string";

export type Successor = { packageName: string; exportName?: string | undefined };
export type MapRow = {
  record: GovernanceRecord;
  stat: RecordStat | undefined;
  /** Package records only: components the package has in any scan, or null when no scan has any. */
  componentCount: number | null;
  /** The successor's own successor, when the successor is itself superseded. */
  nextHop: Successor | null;
};
export type GroupProgress = { inProgress: number; complete: number; unseen: number };
export type MapGroup =
  | { kind: "package"; packageName: string; rows: MapRow[]; progress: GroupProgress }
  | { kind: "whole-packages"; rows: MapRow[]; progress: GroupProgress };
export type MapSection = { kind: "superseded" | "retired"; recordCount: number; groups: MapGroup[] };
/** What's left of a record or a package. */
export type Left = { kind: "no-data" } | { kind: "unseen" } | { kind: "count"; n: number; repos: string[] };
export type PackageGroup =
  | { kind: "components"; packageName: string; rows: MapRow[]; recordCount: number; left: Left; href: string | null }
  | { kind: "whole"; packageName: string; row: MapRow; left: Left };
export type RecordMap = { groups: PackageGroup[]; complete: PackageGroup[]; completeRecords: number };
export type LeftText =
  | { kind: "no-data" | "unseen" | "none"; text: string }
  | { kind: "count"; n: string; where: string | null; text: string };

type MapInput = {
  visible: GovernanceRecord[];
  all: GovernanceRecord[];
  stats: Record<string, RecordStat>;
  sources: { packageName: string; exportName?: string }[];
};

const RANK: Record<RecordStat["status"], number> = { unseen: 0, active: 1, complete: 2 };

export function rowName(r: GovernanceRecord): string {
  return r.targetExport ?? r.targetPackage;
}

function nextHopOf(record: GovernanceRecord, stat: RecordStat | undefined, all: GovernanceRecord[]): Successor | null {
  if (record.disposition.kind !== "superseded" || !stat?.successorDeprecated) return null;
  const { packageName, exportName } = record.disposition.by;
  const next = resolveGovernance({ packageName, name: exportName ?? null }, all);
  return next.status === "superseded" ? next.by : null;
}

function rowMaker(input: MapInput): (record: GovernanceRecord) => MapRow {
  const components = new Map<string, Set<string>>();
  for (const s of input.sources) {
    if (!s.exportName) continue;
    const set = components.get(s.packageName) ?? new Set<string>();
    set.add(s.exportName);
    components.set(s.packageName, set);
  }
  return (record) => {
    const stat = input.stats[record.id];
    return {
      record,
      stat,
      componentCount: record.grain === "package" ? (components.get(record.targetPackage)?.size ?? null) : null,
      nextHop: nextHopOf(record, stat, input.all),
    };
  };
}

function progressOf(rows: MapRow[]): GroupProgress {
  const p: GroupProgress = { inProgress: 0, complete: 0, unseen: 0 };
  for (const { stat } of rows) {
    if (stat?.status === "active") p.inProgress++;
    else if (stat?.status === "complete") p.complete++;
    else if (stat?.status === "unseen") p.unseen++;
  }
  return p;
}

export function buildRecordMap(input: MapInput): MapSection[] {
  const toRow = rowMaker(input);
  const order = (a: MapRow, b: MapRow) =>
    (a.stat ? RANK[a.stat.status] : 3) - (b.stat ? RANK[b.stat.status] : 3) ||
    rowName(a.record).localeCompare(rowName(b.record));

  const sections: MapSection[] = [];
  for (const kind of ["superseded", "retired"] as const) {
    const records = input.visible.filter((r) => r.disposition.kind === kind);
    if (records.length === 0) continue;
    const byPackage = new Map<string, MapRow[]>();
    const whole: MapRow[] = [];
    for (const r of records) {
      if (r.grain === "package") {
        whole.push(toRow(r));
        continue;
      }
      const rows = byPackage.get(r.targetPackage) ?? [];
      rows.push(toRow(r));
      byPackage.set(r.targetPackage, rows);
    }
    const groups: MapGroup[] = [...byPackage.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([packageName, rows]) => {
        rows.sort(order);
        return { kind: "package", packageName, rows, progress: progressOf(rows) };
      });
    if (whole.length > 0) {
      whole.sort(order);
      groups.push({ kind: "whole-packages", rows: whole, progress: progressOf(whole) });
    }
    sections.push({ kind, recordCount: records.length, groups });
  }
  return sections;
}

export function leftOf(stat: RecordStat | undefined): Left {
  if (!stat) return { kind: "no-data" };
  if (stat.status === "unseen") return { kind: "unseen" };
  return { kind: "count", n: stat.left, repos: stat.leftIn };
}

function totalOf(rows: MapRow[]): Left {
  const lefts = rows.map((r) => leftOf(r.stat));
  if (lefts.some((l) => l.kind === "no-data")) return { kind: "no-data" };
  const counts = lefts.filter((l): l is Extract<Left, { kind: "count" }> => l.kind === "count");
  if (counts.length === 0) return { kind: "unseen" };
  return {
    kind: "count",
    n: counts.reduce((sum, l) => sum + l.n, 0),
    repos: [...new Set(counts.flatMap((l) => l.repos))].sort(),
  };
}

const sortValue = (left: Left) => (left.kind === "count" ? left.n : left.kind === "unseen" ? 0 : -1);
const packagePath = (name: string) => `/packages/${encodeURIComponent(name)}`;

export function recordHref(record: GovernanceRecord, stat: RecordStat | undefined): string | null {
  const ids = stat?.componentIds ?? [];
  if (ids.length === 0) return null;
  if (record.grain === "package") return packagePath(record.targetPackage);
  if (ids.length === 1) return `/components/${encodeURIComponent(ids[0] as string)}`;
  return hrefWithQuery(
    packagePath(record.targetPackage),
    packageComponentFiltersToParams({ text: record.targetExport ?? "", deprecated: true }),
  );
}

export function groupRecords(input: MapInput): RecordMap {
  const toRow = rowMaker(input);
  const visible = new Set(input.visible.map((r) => r.id));
  const byPackage = new Map<string, MapRow[]>();
  for (const record of input.all) {
    const rows = byPackage.get(record.targetPackage) ?? [];
    rows.push(toRow(record));
    byPackage.set(record.targetPackage, rows);
  }

  const byLeft = (a: MapRow, b: MapRow) =>
    sortValue(leftOf(b.stat)) - sortValue(leftOf(a.stat)) || rowName(a.record).localeCompare(rowName(b.record));
  const groups: PackageGroup[] = [];
  const complete: PackageGroup[] = [];
  let completeRecords = 0;
  for (const [packageName, rows] of byPackage) {
    if (!rows.some((r) => visible.has(r.record.id))) continue;
    rows.sort(byLeft);
    const left = totalOf(rows);
    const [only] = rows;
    const group: PackageGroup =
      rows.length === 1 && only?.record.grain === "package"
        ? { kind: "whole", packageName, row: only, left }
        : {
            kind: "components",
            packageName,
            rows: rows.filter((r) => visible.has(r.record.id)),
            recordCount: rows.length,
            left,
            href: rows.some((r) => (r.stat?.componentIds.length ?? 0) > 0) ? packagePath(packageName) : null,
          };
    if (rows.every((r) => r.stat?.status === "complete")) {
      complete.push(group);
      completeRecords += rows.length;
    } else {
      groups.push(group);
    }
  }

  const byTotal = (a: PackageGroup, b: PackageGroup) =>
    sortValue(b.left) - sortValue(a.left) || a.packageName.localeCompare(b.packageName);
  return { groups: groups.sort(byTotal), complete: complete.sort(byTotal), completeRecords };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function statusLabel(stat: RecordStat | undefined, repoCount: number): string | null {
  if (!stat) return null;
  if (stat.status === "unseen") return "Never matched a scan";
  if (stat.status === "complete") return "Complete";
  return repoCount > 1 ? `Used in ${plural(stat.leftIn.length, "repo", "repos")}` : "In use";
}

export function leftText(left: Left, repoCount: number): LeftText {
  if (left.kind === "no-data") return { kind: "no-data", text: "No data" };
  if (left.kind === "unseen") return { kind: "unseen", text: "Not in any scan" };
  if (left.n === 0) return { kind: "none", text: "None left" };
  const n = left.n.toLocaleString();
  const where =
    repoCount < 2 || left.repos.length === 0
      ? null
      : left.repos.length === 1
        ? (left.repos[0] as string)
        : `${left.repos.length.toLocaleString()} repos`;
  return { kind: "count", n, where, text: where ? `${n} in ${where}` : n };
}

export function progressLabel(p: GroupProgress): string {
  return [
    p.inProgress > 0 ? `${p.inProgress.toLocaleString()} in progress` : null,
    p.complete > 0 ? `${p.complete.toLocaleString()} complete` : null,
    p.unseen > 0 ? `${p.unseen.toLocaleString()} never matched a scan` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function countLabel(n: number): string {
  return plural(n, "component", "components");
}

export function recordCountLabel(n: number): string {
  return plural(n, "record", "records");
}

export function wholePackageLabel(componentCount: number | null): string {
  return componentCount === null ? "Whole package" : `Whole package · ${countLabel(componentCount)}`;
}

export function scopeLabel(n: number | null): string | null {
  if (n === null) return null;
  return n === 1 ? "1 component" : `All ${n.toLocaleString()} components`;
}

export function successorLabel(s: Successor): { name: string; packageName: string | null } {
  return s.exportName ? { name: s.exportName, packageName: s.packageName } : { name: s.packageName, packageName: null };
}
