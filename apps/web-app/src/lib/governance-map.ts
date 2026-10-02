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
    rows.sort(byLeft);
    const shown = rows.filter((r) => visible.has(r.record.id));
    if (shown.length === 0) continue;
    const left = totalOf(rows);
    const [only] = rows;
    const group: PackageGroup =
      rows.length === 1 && only?.record.grain === "package"
        ? { kind: "whole", packageName, row: only, left }
        : {
            kind: "components",
            packageName,
            rows: shown,
            recordCount: rows.length,
            left,
            href: rows.some((r) => recordHref(r.record, r.stat) !== null) ? packagePath(packageName) : null,
          };
    if (rows.every((r) => r.stat?.status === "complete")) {
      complete.push(group);
      completeRecords += shown.length;
    } else {
      groups.push(group);
    }
  }

  const byTotal = (a: PackageGroup, b: PackageGroup) =>
    sortValue(b.left) - sortValue(a.left) || a.packageName.localeCompare(b.packageName);
  return { groups: groups.sort(byTotal), complete: complete.sort(byTotal), completeRecords };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

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

export function successorLabel(s: Successor): { name: string; packageName: string | null } {
  return s.exportName ? { name: s.exportName, packageName: s.packageName } : { name: s.packageName, packageName: null };
}
