"use client";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { CohortSeries, RepoCoverage } from "@scoutui/web-shared";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { NO_KEYS, cohortChartConfig, dayTicks, repoCoverageAt, seriesToRows, seriesWashes, tooltipRowTimestamp } from "@/lib/dashboard-chart-data";
import { DEPRECATED_ONLY, distinctiveLabel, formatAxisCount, formatDay, formatDayTick, formatMetric, formatScanStamp } from "@/lib/dashboard-format";
import { cn } from "@/lib/utils";
import { CohortLabelText, TooltipSeriesName } from "@/components/dashboards/cohort-label";
import { CohortSwatch } from "@/components/dashboards/cohort-swatch";

// From this many series the overlay becomes small multiples. A line past the chart
// order's colours repeats one, and its end label and legend entry tell it apart.
const FACET_THRESHOLD = 5;

/**
 * Cohort occurrences (or share) over time. One area per cohort: a 2px line, with a
 * gradient wash when `seriesWashes` allows it, drawn in on load when motion is
 * allowed. Series are told apart by more than hue: a legend that highlights one
 * series on hover, an end dot and label at each line's tail, and a crosshair
 * tooltip listing every series at that scan. From FACET_THRESHOLD series it
 * renders small multiples on a shared y scale.
 */
export function CohortTrendChart({
  series,
  coverage,
  colors,
  deprecatedOnly = NO_KEYS,
  metric,
  showLegend = true,
}: {
  series: CohortSeries[];
  coverage: RepoCoverage;
  colors: ReadonlyMap<string, string>;
  deprecatedOnly?: ReadonlySet<string>;
  metric: "count" | "share";
  showLegend?: boolean;
}) {
  // Gate the draw-in animation on the user's motion preference.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    setAnimate(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  const [hovered, setHovered] = useState<string | null>(null);
  const gradientId = useId();

  const rows = useMemo(() => seriesToRows(series), [series]);
  const ticks = useMemo(() => dayTicks(rows), [rows]);

  if (rows.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Trends appear once these repos have been scanned more than once.
      </p>
    );
  }
  if (series.length >= FACET_THRESHOLD) {
    return <TrendFacets series={series} coverage={coverage} colors={colors} deprecatedOnly={deprecatedOnly} metric={metric} animate={animate} />;
  }
  const config = cohortChartConfig(series);
  const lastTByKey = new Map(series.map((s) => [s.cohortKey, s.points[s.points.length - 1]?.t]));
  // Reserve just enough right margin for the longest (capped) end label.
  const endLabelChars = (s: CohortSeries) => Math.max(distinctiveLabel(s.label).length, deprecatedOnly.has(s.cohortKey) ? DEPRECATED_ONLY.length : 0);
  const rightMargin = Math.min(168, 30 + Math.max(0, ...series.map(endLabelChars)) * 7);
  // `seriesWashes` decides which series get the wash, here and in the sparkline.
  const washes = seriesWashes(series);
  // End-label declutter: a tail closer than the label box above it (~13px a line,
  // approximated in data space) keeps its dot but drops its label. A two-line label
  // that would hang below the plot sits a line higher, its second line level with the dot.
  // Hovering a legend row always shows that series' label.
  const labelled = new Set<string>();
  const lifted = new Set<string>();
  {
    const PLOT_PX = 230; // chart height minus vertical margins and the x-axis band
    const LABEL_PX = 13;
    const domainMax = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
    const minGap = (LABEL_PX / PLOT_PX) * domainMax;
    const tails = series
      .map((s) => ({ key: s.cohortKey, v: s.points[s.points.length - 1]?.value ?? 0 }))
      .sort((a, b) => b.v - a.v);
    let lastV: number | null = null;
    let lastGap = minGap;
    for (const tail of tails) {
      const twoLines = deprecatedOnly.has(tail.key);
      const lift = twoLines && tail.v < 2 * minGap;
      if (lift) lifted.add(tail.key);
      const top = lift ? tail.v + minGap : tail.v;
      if (lastV === null || lastV - top >= lastGap) {
        labelled.add(tail.key);
        lastV = tail.v;
        lastGap = twoLines && !lift ? 2 * minGap : minGap;
      }
    }
  }

  return (
    <div>
      <ChartContainer config={config} className="h-[280px] w-full">
        <AreaChart data={rows} margin={{ left: 8, right: rightMargin, top: 12, bottom: 4 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.cohortKey} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: colors.get(s.cohortKey), stopOpacity: 0.22 }} />
                <stop offset="100%" style={{ stopColor: colors.get(s.cohortKey), stopOpacity: 0.02 }} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            ticks={ticks}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatDayTick}
            tick={{ fontSize: 10, fontFamily: "var(--font-sans)", fill: "var(--faint)" }}
            minTickGap={32}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => (metric === "share" ? `${Math.round(v * 100)}%` : formatAxisCount(v))}
            tick={{ fontSize: 10, fontFamily: "var(--font-sans)", fill: "var(--faint)" }}
          />
          <ChartTooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => scanTooltipLabel(payload, coverage)}
                formatter={(value, name, item) => (
                  <>
                    <span
                      className="mt-[5px] h-0.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: item?.color }}
                    />
                    <div className="flex flex-1 items-center justify-between gap-3 leading-none">
                      <TooltipSeriesName name={config[String(name)]?.label ?? name} deprecatedOnly={deprecatedOnly.has(String(name))} />
                      <span className="font-medium tabular-nums text-foreground">
                        {formatMetric(Number(value), metric)}
                      </span>
                    </div>
                  </>
                )}
              />
            }
          />
          {series.map((s, i) => {
            const color = colors.get(s.cohortKey) ?? "";
            const dimmed = hovered !== null && hovered !== s.cohortKey;
            return (
              <Area
                key={s.cohortKey}
                type="monotone"
                dataKey={s.cohortKey}
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                fill={washes[i] ? `url(#${gradientId}-${i})` : "transparent"}
                fillOpacity={dimmed ? 0.15 : 1}
                strokeOpacity={dimmed ? 0.25 : 1}
                className="transition-opacity duration-200"
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                dot={(props: { cx?: number; cy?: number; payload?: { t?: string } }) => {
                  // A single end-dot (with a surface ring) marks the line's tail and
                  // ties the muted end label to its series without colouring the text.
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null || payload?.t !== lastTByKey.get(s.cohortKey)) return <g key={`${s.cohortKey}-none-${props.cx}`} />;
                  const showLabel = labelled.has(s.cohortKey) || hovered === s.cohortKey;
                  return (
                    <g key={`${s.cohortKey}-end`} className="transition-opacity duration-200" opacity={dimmed ? 0.25 : 1}>
                      <circle cx={cx} cy={cy} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />
                      {showLabel ? (
                        <text
                          x={cx + 9}
                          y={cy}
                          dy={lifted.has(s.cohortKey) ? -9 : 3}
                          fontSize={11}
                          fontFamily="var(--font-mono)"
                          fill="var(--muted-foreground)"
                        >
                          {distinctiveLabel(s.label)}
                          {deprecatedOnly.has(s.cohortKey) ? (
                            <tspan x={cx + 9} dy={12} fontSize={10} fontFamily="var(--font-sans)">
                              {DEPRECATED_ONLY}
                            </tspan>
                          ) : null}
                        </text>
                      ) : null}
                    </g>
                  );
                }}
                isAnimationActive={animate}
                animationDuration={400}
                animationEasing="ease-out"
              />
            );
          })}
        </AreaChart>
      </ChartContainer>

      {/* Hovering a legend entry highlights its series and dims the rest. A single
          series needs no legend: the title names it. */}
      {showLegend && series.length > 1 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
          {series.map((s) => (
            <button
              key={s.cohortKey}
              type="button"
              onMouseEnter={() => setHovered(s.cohortKey)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(s.cohortKey)}
              onBlur={() => setHovered(null)}
              className={cn(
                "inline-flex cursor-default items-center gap-1.5 transition-opacity duration-200",
                "rounded-sm outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                hovered !== null && hovered !== s.cohortKey && "opacity-40",
              )}
            >
              <CohortSwatch cohortKey={s.cohortKey} color={colors.get(s.cohortKey) ?? ""} role={s.role} />
              {/* Name and package truncate separately: a merged series and its slice
                  share a name, and one truncated string would render them alike. */}
              <CohortLabelText label={s.label} deprecatedOnly={deprecatedOnly.has(s.cohortKey)} className="max-w-[24rem] text-xs" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A tooltip's heading: the scan time, and beneath it how many repos the point covers when the chart covers more than one. */
export function scanTooltipLabel(payload: ReadonlyArray<{ payload?: unknown }> | undefined, coverage: RepoCoverage): ReactNode {
  const ts = tooltipRowTimestamp(payload);
  if (ts === null) return "";
  const repos = repoCoverageAt(coverage, ts);
  return (
    <>
      {formatScanStamp(ts)}
      {repos ? <span className="block font-normal text-muted-foreground">{repos}</span> : null}
    </>
  );
}

/**
 * Small multiples: one small area panel per cohort in a grid, each titled with its
 * series and drawn with its full wash. All panels share the y domain, stated in the
 * caption, so heights compare across panels. Exact values are in each panel's
 * tooltip and latest-value readout.
 */
function TrendFacets({
  series,
  coverage,
  colors,
  deprecatedOnly,
  metric,
  animate,
}: {
  series: CohortSeries[];
  coverage: RepoCoverage;
  colors: ReadonlyMap<string, string>;
  deprecatedOnly: ReadonlySet<string>;
  metric: "count" | "share";
  animate: boolean;
}) {
  const gradientId = useId();
  const domainMax = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const allT = series.flatMap((s) => s.points.map((p) => p.t)).sort();
  const firstT = allT[0];
  const lastT = allT[allT.length - 1];

  return (
    <div>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {series.map((s, i) => {
          const color = colors.get(s.cohortKey) ?? "";
          const last = s.points[s.points.length - 1];
          const rows = s.points.map((p) => ({ t: p.t, ts: Date.parse(p.t), v: p.value }));
          return (
            <div key={s.cohortKey} className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <CohortSwatch cohortKey={s.cohortKey} color={color} role={s.role} className="self-center" />
                <CohortLabelText label={s.label} deprecatedOnly={deprecatedOnly.has(s.cohortKey)} className="text-xs" />
                <span className="ml-auto shrink-0 pl-2 text-sm font-medium tabular-nums">
                  {last ? formatMetric(last.value, metric) : "—"}
                </span>
              </div>
              <ChartContainer config={{ v: { label: s.label } }} className="mt-1.5 h-[104px] w-full">
                <AreaChart data={rows} margin={{ left: 2, right: 2, top: 4, bottom: 2 }}>
                  <defs>
                    <linearGradient id={`${gradientId}-f${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.22 }} />
                      <stop offset="100%" style={{ stopColor: color, stopOpacity: 0.02 }} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
                  <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} hide />
                  <YAxis hide domain={[0, domainMax]} />
                  <ChartTooltip
                    cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, payload) => scanTooltipLabel(payload, coverage)}
                        formatter={(value) => (
                          <div className="flex flex-1 items-center justify-between gap-3 leading-none">
                            <TooltipSeriesName name={distinctiveLabel(s.label)} deprecatedOnly={deprecatedOnly.has(s.cohortKey)} />
                            <span className="font-medium tabular-nums text-foreground">
                              {formatMetric(Number(value), metric)}
                            </span>
                          </div>
                        )}
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    fill={`url(#${gradientId}-f${i})`}
                    dot={false}
                    activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--card)" }}
                    isAnimationActive={animate}
                    animationDuration={400}
                    animationEasing="ease-out"
                  />
                </AreaChart>
              </ChartContainer>
            </div>
          );
        })}
      </div>
      {firstT && lastT ? (
        <p className="mt-4 text-xs tabular-nums text-muted-foreground">
          {formatDay(firstT)} – {formatDay(lastT)}
        </p>
      ) : null}
    </div>
  );
}
