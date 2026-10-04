"use client";
import { useState } from "react";
import type { ChartRange, DashboardConfig, DashboardView } from "@scoutui/web-shared";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { chartColors, deprecatedOnlyKeys, drawnChartCohorts, isEmptyView, rangeStart, savedChartCohorts, visibleView } from "@/lib/dashboard-chart-data";
import { useShowChart } from "./chart-export-context";
import { CohortBarChart } from "./cohort-bar-chart";
import { CohortShareOverTime } from "./cohort-share-over-time";
import { CohortTable } from "./cohort-table";
import { CohortTrendChart } from "./cohort-trend-chart";

const RANGES: Array<{ value: ChartRange; label: string }> = [
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "1y", label: "1 year" },
  { value: "all", label: "All" },
];

/**
 * Dispatch a (chartType, view) pair to the matching chart. `trend` and
 * `stacked-share` consume the over-time series; `table` consumes the snapshot and
 * each cohort's change; `bars` consumes the snapshot. Client-side so it
 * can be rendered both from server pages (view route) and the builder's preview.
 * A chart over time draws `range`; with `onRangeChange` it offers the range presets
 * once its scans span more than the shortest one.
 */
export function DashboardChart({
  config,
  view,
  showLegend = true,
  range = "all",
  onRangeChange,
}: {
  config: DashboardConfig;
  view: DashboardView;
  showLegend?: boolean;
  range?: ChartRange;
  onRangeChange?: (range: ChartRange) => void;
}) {
  if (isEmptyView(view)) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Couldn't find the components in this chart.</p>;
  }
  const colors = chartColors(savedChartCohorts(config.cohorts, drawnChartCohorts(view)));
  const deprecatedOnly = deprecatedOnlyKeys(config.cohorts);
  if (config.chartType === "trend" || config.chartType === "stacked-share") {
    if (view.kind !== "series") return <ChartFallback />;
    const { view: visible, from } = visibleView(config, view, range);
    const presets = onRangeChange && rangeStart(view.series, "3m") !== null;
    return (
      <div>
        {presets ? (
          <div className="mb-3 flex justify-end">
            <ToggleGroup
              value={[range]}
              onValueChange={(v) => {
                const next = RANGES.find((r) => r.value === v[0]);
                if (next) onRangeChange(next.value);
              }}
              variant="outline"
              size="sm"
              multiple={false}
              aria-label="Date range"
            >
              {RANGES.map((r) => (
                <ToggleGroupItem key={r.value} value={r.value}>
                  {r.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : null}
        {config.chartType === "trend" ? (
          <CohortTrendChart series={visible.series} coverage={view.coverage} colors={colors} deprecatedOnly={deprecatedOnly} metric={config.metric} showLegend={showLegend} from={from} />
        ) : (
          <CohortShareOverTime series={visible.series} coverage={view.coverage} colors={colors} deprecatedOnly={deprecatedOnly} showLegend={showLegend} from={from} />
        )}
      </div>
    );
  }
  if (config.chartType === "table") {
    return view.kind === "table" ? <CohortTable points={view.points} change={view.change} colors={colors} deprecatedOnly={deprecatedOnly} metric={config.metric} /> : <ChartFallback />;
  }
  if (view.kind !== "snapshot") return <ChartFallback />;
  return config.chartType === "bars" ? <CohortBarChart points={view.points} colors={colors} deprecatedOnly={deprecatedOnly} metric={config.metric} /> : <ChartFallback />;
}

/**
 * A DashboardChart on a chart's own page: it opens at `range`, a picked range goes into the page's link, and the chart
 * at the range on screen is offered for export.
 */
export function LinkedDashboardChart({ config, view, range: initial }: { config: DashboardConfig; view: DashboardView; range: ChartRange }) {
  const [range, setRange] = useState(initial);
  useShowChart({ config, view, range });
  const pick = (next: ChartRange) => {
    setRange(next);
    const url = new URL(window.location.href);
    url.searchParams.set("range", next);
    window.history.replaceState(null, "", url);
  };
  return <DashboardChart config={config} view={view} range={range} onRangeChange={pick} />;
}

function ChartFallback() {
  // A (chartType, view.kind) mismatch shows this rather than a blank panel.
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">
      This chart has no data yet.
    </p>
  );
}
