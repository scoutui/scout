import type { CohortPoint, CohortSelector, CohortSeries, DashboardConfig, GovernanceRecord, Tag } from "./dto.js";
import type { DigestScan } from "./digest.js";
import { cohortKey, projectCohortSnapshot, projectCohortSeries, projectRepoCoverage, resolveCohort, type RepoCoverage } from "./cohorts.js";
import { changeIn } from "./governance-tracking.js";
import { latestScanPerRepo } from "./scan-order.js";

export type DashboardView =
  | { kind: "snapshot"; points: CohortPoint[] }
  | { kind: "series"; series: CohortSeries[]; coverage: RepoCoverage }
  | { kind: "table"; points: CohortPoint[]; series: CohortSeries[]; coverage: RepoCoverage; change: Record<string, number | null> };

// Chart kinds that read history, not just the latest scan per repo. `table` reads
// it for each cohort's change.
const HISTORY_TYPES = new Set<DashboardConfig["chartType"]>(["trend", "stacked-share", "table"]);

export function isSeriesChart(config: DashboardConfig): boolean {
  return HISTORY_TYPES.has(config.chartType);
}

/**
 * Pure: project a config against the given scan digests. `names` holds digests from
 * other scans that are used only to name a series and give it its role, never for values.
 * `asOf` ends the window a table's change across all repos is measured over.
 */
export function renderDashboard(
  config: DashboardConfig,
  scans: DigestScan[],
  tags: Tag[],
  asOf: string,
  governance: GovernanceRecord[] = [],
  names: DigestScan[] = [],
): DashboardView {
  if (config.chartType === "trend") {
    return { kind: "series", series: projectCohortSeries(scans, tags, config.cohorts, config.metric, governance, names), coverage: projectRepoCoverage(scans) };
  }
  if (config.chartType === "stacked-share") {
    // Always shares, whatever the config's metric.
    return { kind: "series", series: projectCohortSeries(scans, tags, config.cohorts, "share", governance, names), coverage: projectRepoCoverage(scans) };
  }
  if (config.chartType === "table") {
    const points = projectCohortSnapshot(scans, tags, config.cohorts, config.metric, governance, names);
    return {
      kind: "table",
      points,
      series: projectCohortSeries(scans, tags, config.cohorts, config.metric, governance, names),
      coverage: projectRepoCoverage(scans),
      change: cohortChange(config, points, scans, tags, governance, asOf),
    };
  }
  return { kind: "snapshot", points: projectCohortSnapshot(scans, tags, config.cohorts, config.metric, governance, names) };
}

/**
 * The change of each cohort in `drawn` by `cohortKey`, measured by `changeIn`. A share's change is the share of the
 * summed counts at each repo's latest scan less the share of the summed counts at the scans those are compared with.
 */
export function cohortChange(
  config: DashboardConfig,
  drawn: ReadonlyArray<{ cohortKey: string }>,
  scans: DigestScan[],
  tags: Tag[],
  governance: GovernanceRecord[],
  asOf: string,
): Record<string, number | null> {
  const counts = new Map<string, number[]>();
  const countsIn = (scan: DigestScan): number[] => {
    const hit = counts.get(scan.meta.scanId);
    if (hit) return hit;
    const each = config.cohorts.map((selector) => resolveCohort(selector, scan, tags, governance).occurrences);
    counts.set(scan.meta.scanId, each);
    return each;
  };
  const changeOf = (countOf: (scan: DigestScan) => number) => changeIn(scans, countOf, asOf).delta;
  const latest = latestScanPerRepo(scans);
  const atLatest = (countOf: (scan: DigestScan) => number) => latest.reduce((n, scan) => n + countOf(scan), 0);
  const total = (scan: DigestScan) => countsIn(scan).reduce((n, count) => n + count, 0);
  const totalNow = atLatest(total);
  const totalBefore = totalNow - (changeOf(total) ?? 0);
  const share = (count: number, of: number) => (of === 0 ? 0 : count / of);
  const drawnKeys = new Set(drawn.map((c) => c.cohortKey));
  return Object.fromEntries(config.cohorts.flatMap((selector, i) => {
    const key = cohortKey(selector);
    if (!drawnKeys.has(key)) return [];
    const count = (scan: DigestScan) => countsIn(scan)[i] ?? 0;
    const delta = changeOf(count);
    if (delta === null || config.metric === "count") return [[key, delta]];
    const now = atLatest(count);
    return [[key, share(now, totalNow) - share(now - delta, totalBefore)]];
  }));
}

/** The keys of the cohorts `view` doesn't draw because nothing can name them (see `drawnCohorts`). */
export function unknownCohortKeys(cohorts: CohortSelector[], view: DashboardView): Set<string> {
  const drawn = new Set((view.kind === "series" ? view.series : view.points).map((c) => c.cohortKey));
  return new Set(cohorts.map(cohortKey).filter((key) => !drawn.has(key)));
}
