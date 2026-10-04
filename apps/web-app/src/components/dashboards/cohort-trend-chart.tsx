"use client";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { CohortSeries, RepoCoverage } from "@scoutui/web-shared";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { NO_KEYS, cohortChartConfig, dayTicks, lineJoins, repoCoverageAt, reposJoiningAt, seriesToRows, seriesWashes, tooltipRowTimestamp } from "@/lib/dashboard-chart-data";
import { DEPRECATED_ONLY, distinctiveLabel, formatAxisCount, formatDayTick, formatMetric, formatScanStamp } from "@/lib/dashboard-format";
import { cn } from "@/lib/utils";
import { CohortLabelText, TooltipSeriesName } from "@/components/dashboards/cohort-label";
import { CohortSwatch } from "@/components/dashboards/cohort-swatch";
import { TrendLegendTable } from "@/components/dashboards/trend-legend-table";

// From this many series the legend is a sortable table.
const TABLE_LEGEND_FROM = 6;

/**
 * Cohort occurrences (or share) over time. One area per cohort: a 2px line, with a
 * gradient wash when `seriesWashes` allows it, drawn in on load when motion is
 * allowed. Series are told apart by more than hue: a legend that highlights one
 * series on hover and shows only that series on click, an end dot and label at each
 * line's tail, and a crosshair tooltip listing every series at that scan. A small
 * ring marks each scan where a repo joins a line, and the tooltip names it. From
 * TABLE_LEGEND_FROM series the legend is a table of each series' latest value.
 * With `from`, the x-axis starts there and points before it fall outside the plot.
 */
export function CohortTrendChart({
  series: allSeries,
  coverage,
  colors,
  deprecatedOnly = NO_KEYS,
  metric,
  showLegend = true,
  from = null,
}: {
  series: CohortSeries[];
  coverage: RepoCoverage;
  colors: ReadonlyMap<string, string>;
  deprecatedOnly?: ReadonlySet<string>;
  metric: "count" | "share";
  showLegend?: boolean;
  from?: number | null;
}) {
  // Gate the draw-in animation on the user's motion preference.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    setAnimate(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  const [hovered, setHovered] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const gradientId = useId();

  const rows = useMemo(() => seriesToRows(allSeries), [allSeries]);
  const ticks = useMemo(() => dayTicks(rows).filter((t) => from === null || t >= from), [rows, from]);

  if (rows.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Trends appear once these repos have been scanned more than once.
      </p>
    );
  }
  const series = shown === null ? allSeries : allSeries.filter((s) => s.cohortKey === shown);
  const toggleShown = (key: string) => setShown((current) => (current === key ? null : key));
  const highlighted = shown === null ? hovered : null;
  const config = cohortChartConfig(allSeries);
  const lastTByKey = new Map(series.map((s) => [s.cohortKey, s.points[s.points.length - 1]?.t]));
  const joins = lineJoins(series);
  // Reserve just enough right margin for the longest (capped) end label.
  const endLabelChars = (s: CohortSeries) => Math.max(distinctiveLabel(s.label).length, deprecatedOnly.has(s.cohortKey) ? DEPRECATED_ONLY.length : 0);
  const rightMargin = Math.min(168, 30 + Math.max(0, ...allSeries.map(endLabelChars)) * 7);
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
    const domainMax = Math.max(1, ...series.flatMap((s) => s.points.filter((p) => from === null || Date.parse(p.t) >= from).map((p) => p.value)));
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
            tickFormatter={(v: number) => (metric === "share" ? `${Math.round(v * 100)}%` : formatAxisCount(v))}
            tick={{ fontSize: 11, fontFamily: "var(--font-sans)", fill: "var(--faint)" }}
          />
          <ChartTooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={(props) => (
              <ChartTooltipContent
                active={props.active && tooltipRowTimestamp(props.payload) !== from}
                payload={props.payload}
                label={props.label}
                labelFormatter={(_, payload) => scanTooltipLabel(payload, coverage, series)}
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
            )}
          />
          {series.map((s, i) => {
            const color = colors.get(s.cohortKey) ?? "";
            const dimmed = highlighted !== null && highlighted !== s.cohortKey;
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
                  if (cx != null && cy != null && payload?.t !== lastTByKey.get(s.cohortKey) && joins.get(s.cohortKey)?.has(payload?.t ?? "")) {
                    return <JoinMarker key={`${s.cohortKey}-join-${payload?.t}`} cx={cx} cy={cy} color={color} dimmed={dimmed} />;
                  }
                  if (cx == null || cy == null || payload?.t !== lastTByKey.get(s.cohortKey)) return <g key={`${s.cohortKey}-none-${props.cx}`} />;
                  const showLabel = labelled.has(s.cohortKey) || highlighted === s.cohortKey;
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
                            <tspan x={cx + 9} dy={12} fontSize={11} fontFamily="var(--font-sans)">
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

      {/* Hovering a legend entry highlights its series and dims the rest; clicking
          it shows only that series. A single series needs no legend: the title names it. */}
      {showLegend && allSeries.length >= TABLE_LEGEND_FROM ? (
        <TrendLegendTable
          series={allSeries}
          colors={colors}
          deprecatedOnly={deprecatedOnly}
          metric={metric}
          shown={shown}
          onToggle={toggleShown}
          onHover={setHovered}
        />
      ) : showLegend && allSeries.length > 1 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
          {allSeries.map((s) => (
            <button
              key={s.cohortKey}
              type="button"
              aria-pressed={shown === s.cohortKey}
              onClick={() => toggleShown(s.cohortKey)}
              onMouseEnter={() => setHovered(s.cohortKey)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(s.cohortKey)}
              onBlur={() => setHovered(null)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 transition-opacity duration-200",
                "rounded-sm outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                (shown ?? highlighted) !== null && (shown ?? highlighted) !== s.cohortKey && "opacity-40",
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

/** A ring on a line where a repo joins it, in the line's colour on the card surface. */
function JoinMarker({ cx, cy, color, dimmed }: { cx: number; cy: number; color: string; dimmed: boolean }) {
  return <circle cx={cx} cy={cy} r={3} fill="var(--card)" stroke={color} strokeWidth={1.5} opacity={dimmed ? 0.25 : 1} className="transition-opacity duration-200" />;
}

/**
 * A tooltip's heading: the scan time, and beneath it how many repos the point covers when the chart covers more than
 * one, and which repos join `series` there.
 */
export function scanTooltipLabel(payload: ReadonlyArray<{ payload?: unknown }> | undefined, coverage: RepoCoverage, series: CohortSeries[] = []): ReactNode {
  const ts = tooltipRowTimestamp(payload);
  if (ts === null) return "";
  const detail = [repoCoverageAt(coverage, ts), reposJoiningAt(series, ts)].filter(Boolean).join(" · ");
  return (
    <>
      {formatScanStamp(ts)}
      {detail ? <span className="block font-normal text-muted-foreground">{detail}</span> : null}
    </>
  );
}
