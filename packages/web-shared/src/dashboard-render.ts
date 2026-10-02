import type { CohortPoint, CohortSelector, CohortSeries, DashboardConfig, GovernanceRecord, Tag } from "./dto.js";
import type { DigestScan } from "./digest.js";
import { cohortKey, projectCohortSnapshot, projectCohortSeries } from "./cohorts.js";

export type DashboardView =
  | { kind: "snapshot"; points: CohortPoint[] }
  | { kind: "series"; series: CohortSeries[] }
  | { kind: "table"; points: CohortPoint[]; series: CohortSeries[] };

// Chart kinds that read history, not just the latest scan per repo. `table` joins
// the snapshot with the series so it can show Δ since the previous scan.
const HISTORY_TYPES = new Set<DashboardConfig["chartType"]>(["trend", "stacked-share", "table"]);

export function isSeriesChart(config: DashboardConfig): boolean {
  return HISTORY_TYPES.has(config.chartType);
}

/**
 * Pure: project a config against the given scan digests. `names` holds digests from
 * other scans that are used only to name a series and give it its role, never for values.
 */
export function renderDashboard(config: DashboardConfig, scans: DigestScan[], tags: Tag[], governance: GovernanceRecord[] = [], names: DigestScan[] = []): DashboardView {
  if (config.chartType === "trend") {
    return { kind: "series", series: projectCohortSeries(scans, tags, config.cohorts, config.metric, governance, names) };
  }
  if (config.chartType === "stacked-share") {
    // Always shares, whatever the config's metric.
    return { kind: "series", series: projectCohortSeries(scans, tags, config.cohorts, "share", governance, names) };
  }
  if (config.chartType === "table") {
    return {
      kind: "table",
      points: projectCohortSnapshot(scans, tags, config.cohorts, config.metric, governance, names),
      series: projectCohortSeries(scans, tags, config.cohorts, config.metric, governance, names),
    };
  }
  return { kind: "snapshot", points: projectCohortSnapshot(scans, tags, config.cohorts, config.metric, governance, names) };
}

/** The keys of the cohorts `view` doesn't draw because nothing can name them (see `drawnCohorts`). */
export function unknownCohortKeys(cohorts: CohortSelector[], view: DashboardView): Set<string> {
  const drawn = new Set((view.kind === "series" ? view.series : view.points).map((c) => c.cohortKey));
  return new Set(cohorts.map(cohortKey).filter((key) => !drawn.has(key)));
}
