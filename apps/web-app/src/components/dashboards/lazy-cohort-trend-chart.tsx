"use client";
import dynamic from "next/dynamic";

/** CohortTrendChart with recharts loaded only when a chart first renders, holding its plot's height meanwhile. */
export const LazyCohortTrendChart = dynamic(
  () => import("@/components/dashboards/cohort-trend-chart").then((m) => m.CohortTrendChart),
  { loading: () => <div aria-hidden className="h-[280px] w-full animate-pulse motion-reduce:animate-none rounded-md bg-muted/40" /> },
);
