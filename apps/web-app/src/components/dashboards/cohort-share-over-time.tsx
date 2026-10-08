"use client";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { CohortSeries, RepoCoverage } from "@scoutui/web-shared";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { NO_KEYS, cohortChartConfig, dayTicks, expandRowShares, seriesToRows } from "@/lib/dashboard-chart-data";
import { formatDayTick, formatPct, sharedPackage } from "@/lib/dashboard-format";
import { cn } from "@/lib/utils";
import { CohortShareBar, type ShareSegment } from "./cohort-share-bar";
import { ScanTooltip } from "./cohort-trend-chart";
import { usePinnedTooltip } from "./use-pinned-tooltip";

/**
 * Share over time: a 100%-stacked area over scans, where each band is a cohort's
 * share of the in-scope total at that scan. The latest scan's mix sits above as a
 * share bar whose labelled row is the legend and highlights a band on hover. With
 * fewer than two scans only the bar renders. With `from`, the x-axis starts there. `expandRowShares` renormalises each
 * timestamp itself rather than using Recharts' `stackOffset="expand"` (see its doc),
 * so overlapping series that double-count still fill exactly 100%.
 */
export function CohortShareOverTime({
  series,
  coverage,
  colors,
  deprecatedOnly = NO_KEYS,
  showLegend = true,
  from = null,
}: {
  series: CohortSeries[];
  coverage: RepoCoverage;
  colors: ReadonlyMap<string, string>;
  deprecatedOnly?: ReadonlySet<string>;
  showLegend?: boolean;
  from?: number | null;
}) {
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    setAnimate(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  const [hovered, setHovered] = useState<string | null>(null);
  const pin = usePinnedTooltip();

  const rows = useMemo(() => seriesToRows(series), [series]);
  const shareRows = useMemo(
    () => expandRowShares(rows, series.map((s) => s.cohortKey)),
    [rows, series],
  );
  const ticks = useMemo(() => dayTicks(rows).filter((t) => from === null || t >= from), [rows, from]);

  const latest: ShareSegment[] = series.map((s) => ({
    cohortKey: s.cohortKey,
    label: s.label,
    value: s.points[s.points.length - 1]?.value ?? 0,
    role: s.role,
    deprecatedOnly: deprecatedOnly.has(s.cohortKey),
  }));

  if (rows.length < 2) {
    return <CohortShareBar points={latest} colors={colors} />;
  }
  const config = cohortChartConfig(series);
  const shared = sharedPackage(series.map((s) => s.label));

  return (
    <div className="space-y-4">
      <CohortShareBar points={latest} colors={colors} hovered={hovered} {...(showLegend ? { onHover: setHovered } : {})} />

      <ChartContainer ref={pin.ref} onKeyDown={pin.onKeyDown} config={config} className={cn("h-[240px] w-full", pin.className)}>
        <AreaChart data={shareRows} margin={{ left: 8, right: 8, top: 6, bottom: 4 }} onClick={pin.onClick}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={[from ?? "dataMin", "dataMax"]}
            ticks={ticks}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatDayTick}
            tick={{ fontSize: 11, fontFamily: "var(--font-sans)", fill: "var(--faint)" }}
            minTickGap={32}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tick={{ fontSize: 11, fontFamily: "var(--font-sans)", fill: "var(--faint)" }}
          />
          <ChartTooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            isAnimationActive={false}
            trigger={pin.pinned ? "click" : "hover"}
            wrapperStyle={{ zIndex: 10, pointerEvents: pin.pinned ? "auto" : "none" }}
            content={(props) => (
              <ScanTooltip
                {...props}
                from={from}
                coverage={coverage}
                series={series}
                config={config}
                shared={shared}
                deprecatedOnly={deprecatedOnly}
                pinned={pin.pinned}
                format={formatPct}
                stack={series.map((s) => s.cohortKey)}
              />
            )}
          />
          {series.map((s) => {
            const color = colors.get(s.cohortKey) ?? "";
            const dimmed = hovered !== null && hovered !== s.cohortKey;
            return (
              <Area
                key={s.cohortKey}
                type="monotone"
                dataKey={s.cohortKey}
                stackId="share"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                fill={color}
                fillOpacity={dimmed ? 0.08 : 0.3}
                strokeOpacity={dimmed ? 0.25 : 1}
                className="transition-opacity duration-200"
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={animate}
                animationDuration={400}
                animationEasing="ease-out"
              />
            );
          })}
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
