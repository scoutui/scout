"use client";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import type { ChartRange, DashboardConfig, DashboardView } from "@scoutui/web-shared";

/**
 * A chart as its page shows it: its config, its whole view, the range on screen, the search its table narrows it to,
 * the line shown on its own and its components' paths by cohortKey, which tell same-named components apart.
 */
export type ShownChart = {
  config: DashboardConfig;
  view: DashboardView;
  range: ChartRange;
  query: string;
  shown: string | null;
  paths?: Readonly<Record<string, string>> | undefined;
};

type ChartExport = { title: string; chart: ShownChart | null; show: (chart: ShownChart | null) => void };

const ChartExportContext = createContext<ChartExport | null>(null);

/** Holds the chart shown inside it, for a menu inside it to export under `title`. */
export function ChartExportProvider({ title, children }: { title: string; children: ReactNode }) {
  const [chart, show] = useState<ShownChart | null>(null);
  const value = useMemo(() => ({ title, chart, show }), [title, chart]);
  return <ChartExportContext value={value}>{children}</ChartExportContext>;
}

/** Offers a chart for export while it's on screen inside a `ChartExportProvider`. */
export function useShowChart({ config, view, range, query, shown, paths }: ShownChart): void {
  const show = useContext(ChartExportContext)?.show;
  useEffect(() => {
    if (!show) return;
    show({ config, view, range, query, shown, paths });
    return () => show(null);
  }, [show, config, view, range, query, shown, paths]);
}

/** The chart on screen and the title to export it under, or null when no chart is shown. */
export function useChartExport(): { title: string; chart: ShownChart } | null {
  const state = useContext(ChartExportContext);
  return useMemo(() => (state?.chart ? { title: state.title, chart: state.chart } : null), [state]);
}
