import type {
  CohortSelector,
  CohortSeries,
  DashboardConfig,
  DashboardScope,
  GovernanceRecord,
} from "./dto.js";
import type { DigestScan } from "./digest.js";
import { projectSeries, type SeriesCohort } from "./cohorts.js";
import { governanceHash, governedComponentIds, type GovernanceRule } from "./governance.js";

/**
 * Per-digest-set memo: `deriveChartResults` derives tracking from one digest array
 * several times (the estate, each repo, and again in `deriveRecordStats`). Keyed
 * on the array's identity, so it only serves a result computed from that exact
 * array, and entries are collected with it. The inner key covers everything else
 * the derivation reads.
 */
const trackingMemo = new WeakMap<object, Map<string, GovernanceTracking[]>>();

/**
 * One governance record projected into a trackable chart definition. Series are
 * display-ready (clipped by the observation-window rule and role-stamped), so
 * rows, sparklines and detail pages never re-derive windowing: a series starts
 * at the first scan where the deprecated side is observed, because earlier
 * points reflect scan coverage, not migration state. Each side counts the
 * components its rule governs in each scan (`governedComponentIds`); the
 * config's cohorts name them: the package for a package-wide side, else one
 * component cohort per component the side governs in some in-scope scan.
 */
export type GovernanceTracking = {
  id: string;
  kind: "migration" | "retirement";
  record: GovernanceRecord;
  name: string;
  fromLabel: string;
  toLabel: string | null;
  config: DashboardConfig;
  series: CohortSeries[];
  active: boolean;
  remaining: number;
  progress: number | null;
  delta: number | null;
};

/**
 * Governance records + digests + scope → tracking entries, sorted most-remaining
 * first. A record needs no other opt-in to be tracked:
 * `superseded` → migration (count-trend pair, progress = successor ÷ pair),
 * `retired` → retirement (single count-trend, remaining + Δ, and no percent
 * without a pair). Records that govern nothing in any in-scope scan are
 * skipped, so under a repo scope only the records that apply to that repo remain.
 */
export function deriveGovernanceTracking(
  records: GovernanceRecord[],
  digests: DigestScan[],
  scope: DashboardScope,
): GovernanceTracking[] {
  const scopeKey = scope.kind === "repo" ? `repo:${scope.repoId}` : "all";
  const innerKey = `${scopeKey}::gov=${governanceHash(records)}`;
  let perDigests = trackingMemo.get(digests);
  const hit = perDigests?.get(innerKey);
  if (hit !== undefined) return hit;

  const scans = scope.kind === "repo" ? digests.filter((d) => d.meta.repo.id === scope.repoId) : digests;
  const out: GovernanceTracking[] = [];
  for (const record of records) {
    const entry = deriveOne(record, records, scans, scope);
    if (entry) out.push(entry);
  }
  out.sort((a, b) => b.remaining - a.remaining);

  if (!perDigests) {
    perDigests = new Map();
    trackingMemo.set(digests, perDigests);
  }
  perDigests.set(innerKey, out);
  return out;
}

/** One side of a tracked record: the components a rule governs in each in-scope scan. */
type Side = {
  label: string;
  ids: Set<string>;
  cohorts: CohortSelector[];
  occurrences: (scan: DigestScan) => number;
};

function sideOf(rule: GovernanceRule, records: GovernanceRecord[], scans: DigestScan[], role?: "successor"): Side {
  const governed = new Map(scans.map((s) => [s.meta.scanId, governedComponentIds(rule, s, records)]));
  const ids = new Set([...governed.values()].flatMap((members) => [...members]));
  const name = rule.grain === "component" ? rule.targetExport : null;
  const tagged = role ? { role } : {};
  return {
    label: name === null ? rule.targetPackage : `${name} · ${rule.targetPackage}`,
    ids,
    cohorts: rule.grain === "package"
      ? [{ kind: "package", packageName: rule.targetPackage, ...tagged }]
      : [...ids].sort().map((componentId) => ({ kind: "component", componentId, ...tagged })),
    occurrences: (scan) => {
      const members = governed.get(scan.meta.scanId);
      return scan.components.reduce((n, c) => (members?.has(c.id) ? n + c.stats.occurrenceCount : n), 0);
    },
  };
}

function deriveOne(
  record: GovernanceRecord,
  records: GovernanceRecord[],
  scans: DigestScan[],
  scope: DashboardScope,
): GovernanceTracking | null {
  // The deprecated side follows the record's grain: a component-grain record
  // charts its component, not its whole package.
  const from = sideOf(record, records, scans);
  if (from.ids.size === 0) return null;
  const fromLabel = from.label;
  const shortFrom = fromLabel.split(" · ")[0] ?? fromLabel;
  const deprecated: SeriesCohort = { key: `deprecated:${record.id}`, label: fromLabel, color: "", role: "deprecated", occurrences: from.occurrences };

  if (record.disposition.kind === "retired") {
    const config: DashboardConfig = { scope, cohorts: from.cohorts, chartType: "trend", metric: "count" };
    const counts = clipToObservation(projectSeries(scans, [deprecated], "count"));
    const dep = counts[0];
    const remaining = at(dep, 1);
    const prev = lastPointCount(dep) >= 2 ? at(dep, 2) : null;
    return {
      id: `retirement:${record.id}`,
      kind: "retirement",
      record,
      name: `Retirement: ${shortFrom}`,
      fromLabel,
      toLabel: null,
      config,
      series: counts,
      active: remaining > 0,
      remaining,
      progress: null,
      delta: prev === null ? null : remaining - prev,
    };
  }

  // Successor side: the family `by.exportName` would govern, matched like the deprecated side.
  const by = record.disposition.by;
  const named = by.exportName === undefined
    ? null
    : sideOf({ grain: "component", targetPackage: by.packageName, targetExport: by.exportName }, records, scans, "successor");
  // Falls back to `by`'s whole package when no in-scope scan holds any of that family.
  const to = named !== null && named.ids.size > 0
    ? named
    : sideOf({ grain: "package", targetPackage: by.packageName, targetExport: null }, records, scans, "successor");
  const toLabel = to.label;
  const successor: SeriesCohort = { key: `successor:${record.id}`, label: toLabel, color: "", role: "successor", occurrences: to.occurrences };

  // A migration charts two counts over time, like a retirement; its share is a
  // snapshot carried by the row readout.
  const config: DashboardConfig = { scope, cohorts: [...from.cohorts, ...to.cohorts], chartType: "trend", metric: "count" };
  // Counts are both the display series and the maths (progress = successor ÷ pair).
  const counts = clipToObservation(projectSeries(scans, [deprecated, successor], "count"));
  const [dep, succ] = counts;
  const remaining = at(dep, 1);
  const progress = pairShare(at(dep, 1), at(succ, 1));
  const prevProgress = lastPointCount(dep) >= 2 ? pairShare(at(dep, 2), at(succ, 2)) : null;
  return {
    id: `migration:${record.id}`,
    kind: "migration",
    record,
    name: `Migration: ${shortFrom} → ${toLabel.split(" · ")[0] ?? toLabel}`,
    fromLabel,
    toLabel,
    config,
    series: counts,
    active: remaining > 0,
    remaining,
    progress,
    delta: progress !== null && prevProgress !== null ? (progress - prevProgress) * 100 : null,
  };
}

/** Observation-window rule: drop leading timestamps where the deprecated series is 0. */
function clipToObservation(series: CohortSeries[]): CohortSeries[] {
  const deprecated = series.find((s) => s.role === "deprecated") ?? series[0];
  const firstObserved = deprecated?.points.findIndex((p) => p.value > 0) ?? 0;
  if (firstObserved <= 0) return series;
  return series.map((s) => ({ ...s, points: s.points.slice(firstObserved) }));
}

function at(series: CohortSeries | undefined, back: number): number {
  const points = series?.points ?? [];
  return points[points.length - back]?.value ?? 0;
}

function lastPointCount(series: CohortSeries | undefined): number {
  return series?.points.length ?? 0;
}

function pairShare(dep: number, succ: number): number | null {
  return dep + succ > 0 ? succ / (dep + succ) : null;
}
