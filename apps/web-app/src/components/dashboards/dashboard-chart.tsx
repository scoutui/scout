"use client";
import type { DashboardConfig, DashboardView } from "@scoutui/web-shared";
import { isEmptyView } from "@/lib/dashboard-chart-data";
import { CohortBarChart } from "./cohort-bar-chart";
import { CohortShareOverTime } from "./cohort-share-over-time";
import { CohortTable } from "./cohort-table";
import { CohortTrendChart } from "./cohort-trend-chart";

/**
 * Dispatch a (chartType, view) pair to the matching chart. `trend` and
 * `stacked-share` consume the over-time series; `table` joins snapshot + series
 * (for Δ since the previous scan); `bars` consumes the snapshot. Client-side so it
 * can be rendered both from server pages (view route) and the builder's preview.
 */
export function DashboardChart({
  config,
  view,
  showLegend = true,
}: {
  config: DashboardConfig;
  view: DashboardView;
  showLegend?: boolean;
}) {
  if (isEmptyView(view)) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Couldn't find the components in this chart.</p>;
  }
  if (config.chartType === "trend") {
    return view.kind === "series" ? (
      <CohortTrendChart series={view.series} metric={config.metric} showLegend={showLegend} />
    ) : (
      <ChartFallback />
    );
  }
  if (config.chartType === "stacked-share") {
    return view.kind === "series" ? <CohortShareOverTime series={view.series} showLegend={showLegend} /> : <ChartFallback />;
  }
  if (config.chartType === "table") {
    return view.kind === "table" ? <CohortTable points={view.points} series={view.series} metric={config.metric} /> : <ChartFallback />;
  }
  if (view.kind !== "snapshot") return <ChartFallback />;
  return config.chartType === "bars" ? <CohortBarChart points={view.points} metric={config.metric} /> : <ChartFallback />;
}

function ChartFallback() {
  // A (chartType, view.kind) mismatch shows this rather than a blank panel.
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">
      Nothing to display for this chart.
    </p>
  );
}
