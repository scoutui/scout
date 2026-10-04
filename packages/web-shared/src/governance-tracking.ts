import type {
  CohortSelector,
  CohortSeries,
  DashboardConfig,
  DashboardScope,
  GovernanceRecord,
} from "./dto.js";
import type { DigestScan } from "./digest.js";
import { projectRepoCoverage, projectSeries, type RepoCoverage, type SeriesCohort } from "./cohorts.js";
import { governanceHash, governedComponentIds, type GovernanceRule } from "./governance.js";
import { newestScanFirst, scanOrderTime } from "./scan-order.js";

const CHANGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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
 *
 * `delta` is the change in `remaining`: across all repos, over the 30 days up to
 * the derivation's `asOf`, each repo compared with itself (from its first scan
 * when it joined inside the window); under a repo scope, since the repo's
 * previous scan. Null until some repo with old uses has two scans.
 * `reposAdded` counts the repos that joined inside the window and still have
 * old uses, when some repo was scanned before it.
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
  coverage: RepoCoverage;
  active: boolean;
  remaining: number;
  progress: number | null;
  delta: number | null;
  reposAdded: number;
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
  asOf: string,
): GovernanceTracking[] {
  const scopeKey = scope.kind === "repo" ? `repo:${scope.repoId}` : `all:${Date.parse(asOf)}`;
  const innerKey = `${scopeKey}::gov=${governanceHash(records)}`;
  let perDigests = trackingMemo.get(digests);
  const hit = perDigests?.get(innerKey);
  if (hit !== undefined) return hit;

  const scans = scope.kind === "repo" ? digests.filter((d) => d.meta.repo.id === scope.repoId) : digests;
  const out: GovernanceTracking[] = [];
  for (const record of records) {
    const entry = deriveOne(record, records, scans, scope, asOf);
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
  asOf: string,
): GovernanceTracking | null {
  // The deprecated side follows the record's grain: a component-grain record
  // charts its component, not its whole package.
  const from = sideOf(record, records, scans);
  if (from.ids.size === 0) return null;
  const fromLabel = from.label;
  const shortFrom = fromLabel.split(" · ")[0] ?? fromLabel;
  const deprecated: SeriesCohort = { key: `deprecated:${record.id}`, label: fromLabel, color: "", role: "deprecated", occurrences: from.occurrences };
  const change = scope.kind === "repo" ? sincePreviousScan(scans, from.occurrences) : overWindow(scans, from.occurrences, asOf);

  if (record.disposition.kind === "retired") {
    const config: DashboardConfig = { scope, cohorts: from.cohorts, chartType: "trend", metric: "count" };
    const { series: counts, coverage } = clipToObservation(projectSeries(scans, [deprecated], "count"), projectRepoCoverage(scans));
    const remaining = at(counts[0], 1);
    return {
      id: `retirement:${record.id}`,
      kind: "retirement",
      record,
      name: `Retirement: ${shortFrom}`,
      fromLabel,
      toLabel: null,
      config,
      series: counts,
      coverage,
      active: remaining > 0,
      remaining,
      progress: null,
      ...change,
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
  const { series: counts, coverage } = clipToObservation(projectSeries(scans, [deprecated, successor], "count"), projectRepoCoverage(scans));
  const [dep, succ] = counts;
  const remaining = at(dep, 1);
  const progress = pairShare(at(dep, 1), at(succ, 1));
  return {
    id: `migration:${record.id}`,
    kind: "migration",
    record,
    name: `Migration: ${shortFrom} → ${toLabel.split(" · ")[0] ?? toLabel}`,
    fromLabel,
    toLabel,
    config,
    series: counts,
    coverage,
    active: remaining > 0,
    remaining,
    progress,
    ...change,
  };
}

type Change = { delta: number | null; reposAdded: number };

function scansByRepo(scans: DigestScan[]): DigestScan[][] {
  const byRepo = new Map<string, DigestScan[]>();
  for (const scan of scans) {
    const repoScans = byRepo.get(scan.meta.repo.id) ?? [];
    repoScans.push(scan);
    byRepo.set(scan.meta.repo.id, repoScans);
  }
  return [...byRepo.values()].map((repoScans) => repoScans.sort((a, b) => newestScanFirst(a.meta, b.meta)));
}

function sincePreviousScan(scans: DigestScan[], occurrences: (scan: DigestScan) => number): Change {
  const [latest, previous] = [...scans].sort((a, b) => newestScanFirst(a.meta, b.meta));
  return { delta: latest && previous ? occurrences(latest) - occurrences(previous) : null, reposAdded: 0 };
}

function overWindow(scans: DigestScan[], countOf: (scan: DigestScan) => number, asOf: string): Change {
  const counts = new Map(scans.map((scan) => [scan.meta.scanId, countOf(scan)]));
  const occurrences = (scan: DigestScan) => counts.get(scan.meta.scanId) ?? 0;
  const start = Date.parse(asOf) - CHANGE_WINDOW_MS;
  const before = (scan: DigestScan) => Date.parse(scanOrderTime(scan.meta)) <= start;
  const firstMonth = !scans.some(before);
  let delta = 0;
  let reposAdded = 0;
  let reading = false;
  for (const repoScans of scansByRepo(scans)) {
    if (!repoScans.some((scan) => occurrences(scan) > 0)) continue;
    const latest = repoScans[0] as DigestScan;
    const first = repoScans[repoScans.length - 1] as DigestScan;
    const baseline = repoScans.find(before) ?? first;
    reading ||= repoScans.length >= 2;
    delta += occurrences(latest) - occurrences(baseline);
    if (!firstMonth && !before(first) && occurrences(latest) > 0) reposAdded++;
  }
  return { delta: reading ? delta : null, reposAdded };
}

/** Observation-window rule: drop leading timestamps where the deprecated series is 0, from the series and their coverage. */
function clipToObservation(series: CohortSeries[], coverage: RepoCoverage): { series: CohortSeries[]; coverage: RepoCoverage } {
  const deprecated = series.find((s) => s.role === "deprecated") ?? series[0];
  const firstObserved = deprecated?.points.findIndex((p) => p.value > 0) ?? 0;
  if (firstObserved <= 0) return { series, coverage };
  return {
    series: series.map((s) => ({ ...s, points: s.points.slice(firstObserved) })),
    coverage: { ...coverage, points: coverage.points.slice(firstObserved) },
  };
}

function at(series: CohortSeries | undefined, back: number): number {
  const points = series?.points ?? [];
  return points[points.length - back]?.value ?? 0;
}

function pairShare(dep: number, succ: number): number | null {
  return dep + succ > 0 ? succ / (dep + succ) : null;
}
