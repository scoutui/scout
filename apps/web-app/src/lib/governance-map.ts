import type { GovernanceRecord, RecordStat } from "@scoutui/web-shared";
import { resolveGovernance } from "@scoutui/web-shared/client";

export type Successor = { packageName: string; exportName?: string | undefined };
export type MapRow = {
  record: GovernanceRecord;
  stat: RecordStat | undefined;
  /** Package records only: components the package has in scans, or null when no scan has any. */
  componentCount: number | null;
  /** The successor's own successor, when the successor is itself superseded. */
  nextHop: Successor | null;
};
export type GroupProgress = { inProgress: number; complete: number; unseen: number };
export type MapGroup =
  | { kind: "package"; packageName: string; rows: MapRow[]; progress: GroupProgress }
  | { kind: "whole-packages"; rows: MapRow[]; progress: GroupProgress };
export type MapSection = { kind: "superseded" | "retired"; recordCount: number; groups: MapGroup[] };

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

function progressOf(rows: MapRow[]): GroupProgress {
  const p: GroupProgress = { inProgress: 0, complete: 0, unseen: 0 };
  for (const { stat } of rows) {
    if (stat?.status === "active") p.inProgress++;
    else if (stat?.status === "complete") p.complete++;
    else if (stat?.status === "unseen") p.unseen++;
  }
  return p;
}

export function buildRecordMap(input: {
  visible: GovernanceRecord[];
  all: GovernanceRecord[];
  stats: Record<string, RecordStat>;
  sources: { packageName: string; exportName?: string }[];
}): MapSection[] {
  const components = new Map<string, Set<string>>();
  for (const s of input.sources) {
    if (!s.exportName) continue;
    const set = components.get(s.packageName) ?? new Set<string>();
    set.add(s.exportName);
    components.set(s.packageName, set);
  }

  const toRow = (record: GovernanceRecord): MapRow => {
    const stat = input.stats[record.id];
    return {
      record,
      stat,
      componentCount: record.grain === "package" ? (components.get(record.targetPackage)?.size ?? null) : null,
      nextHop: nextHopOf(record, stat, input.all),
    };
  };
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

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function statusLabel(stat: RecordStat | undefined, repoCount: number): string | null {
  if (!stat) return null;
  if (stat.status === "unseen") return "Never matched a scan";
  if (stat.status === "complete") return "Complete";
  return repoCount > 1 ? `Used in ${plural(stat.repos, "repo", "repos")}` : "In use";
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

export function scopeLabel(n: number | null): string | null {
  if (n === null) return null;
  return n === 1 ? "1 component" : `All ${n.toLocaleString()} components`;
}

export function successorLabel(s: Successor): { name: string; packageName: string | null } {
  return s.exportName ? { name: s.exportName, packageName: s.packageName } : { name: s.packageName, packageName: null };
}
