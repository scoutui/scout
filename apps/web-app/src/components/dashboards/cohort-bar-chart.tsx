"use client";
import { useEffect, useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Bar, BarChart, type BarShapeProps, Cell, LabelList, Rectangle, XAxis, YAxis } from "recharts";
import type { CohortPoint, CohortRole } from "@scoutui/web-shared";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { NO_KEYS, cohortChartConfig, } from "@/lib/dashboard-chart-data";
import { DEPRECATED_ONLY, barRowLabel, formatMetric } from "@/lib/dashboard-format";
import { TooltipSeriesName } from "./cohort-label";

// Each row label renders on two lines: the name, then its package (or a package's
// scope) and "deprecated only" muted beneath. SVG text can't truncate, so the lines
// take hard character caps; the tooltip carries the full label.
const ATTR_CAP = 38;
const NAME_CHAR_PX = 6.6;
const ICON_PX = 12;
const ICON_GAP_PX = 4;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function tickLines(label: string, deprecatedOnly: boolean): { name: string; attribution: string; qualifier: string } {
  const { name, attribution } = barRowLabel(label);
  const qualifier = deprecatedOnly ? DEPRECATED_ONLY : "";
  const room = ATTR_CAP - (qualifier ? ` · ${qualifier}`.length : 0);
  return { name, attribution: clip(attribution ?? "", room), qualifier };
}

type BarRow = { cohortKey: string; label: string; value: number; seriesColor: string; role?: CohortRole | undefined; deprecatedOnly: boolean };

function BarTick({
  x = 0,
  y = 0,
  index = 0,
  payload,
  rows,
}: {
  x?: number;
  y?: number;
  index?: number;
  payload?: { value?: unknown };
  rows: BarRow[];
}) {
  const row = rows[index];
  const { name, attribution, qualifier } = tickLines(String(payload?.value ?? ""), row?.deprecatedOnly === true);
  const twoLines = attribution.length > 0 || qualifier.length > 0;
  const nameBaseline = twoLines ? y - 2 : y + 4;
  return (
    <g>
      {row?.role === "deprecated" ? (
        <AlertTriangle
          x={x - name.length * NAME_CHAR_PX - ICON_GAP_PX - ICON_PX}
          y={nameBaseline - 10}
          size={ICON_PX}
          color={row.seriesColor}
        >
          <title>deprecated</title>
        </AlertTriangle>
      ) : null}
      <text x={x} y={y} textAnchor="end" fontFamily="var(--font-mono)">
        {twoLines ? (
          <>
            <tspan x={x} dy={-2} fontSize={11} fill="var(--foreground)">
              {name}
            </tspan>
            <tspan x={x} dy={12} fontSize={11} fill="var(--muted-foreground)">
              {attribution}
              {attribution && qualifier ? " · " : null}
              {qualifier ? <tspan fontFamily="var(--font-sans)">{qualifier}</tspan> : null}
            </tspan>
          </>
        ) : (
          <tspan x={x} dy={4} fontSize={11} fill="var(--muted-foreground)">
            {name}
          </tspan>
        )}
      </text>
    </g>
  );
}

// Per-row band height: a bar of at most 20px in a 36px band.
const ROW_PX = 36;

/**
 * One horizontal bar per cohort at the latest scan, with the value at the bar's tip.
 * Rows sort by value; colour follows the cohort. Bars
 * are at most 20px thick, rounded 4px at the tip, and grow in on load when motion is
 * allowed. Every value is labelled, so the numeric axis and gridlines are off.
 */
export function CohortBarChart({
  points,
  colors,
  deprecatedOnly = NO_KEYS,
  metric,
}: {
  points: CohortPoint[];
  colors: ReadonlyMap<string, string>;
  deprecatedOnly?: ReadonlySet<string>;
  metric: "count" | "share";
}) {
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    setAnimate(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  const gradientId = useId();

  const rows: BarRow[] = points
    .map((p) => ({ cohortKey: p.cohortKey, label: p.label, value: p.value, seriesColor: colors.get(p.cohortKey) ?? "", role: p.role, deprecatedOnly: deprecatedOnly.has(p.cohortKey) }))
    .sort((a, b) => b.value - a.value);
  const config = cohortChartConfig(points);

  const labelWidth = Math.min(
    240,
    16 + Math.max(...rows.map((r) => {
      const { name, attribution, qualifier } = tickLines(r.label, r.deprecatedOnly);
      const mark = r.role === "deprecated" ? ICON_PX + ICON_GAP_PX : 0;
      const secondLine = [attribution, qualifier].filter(Boolean).join(" · ");
      return Math.max(name.length * NAME_CHAR_PX + mark, secondLine.length * 6);
    })),
  );
  const valueWidth = 12 + Math.max(...rows.map((r) => formatMetric(r.value, metric).length)) * 7;
  const height = rows.length * ROW_PX + 8;

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <BarChart data={rows} layout="vertical" margin={{ left: 0, right: valueWidth, top: 4, bottom: 4 }}>
        <defs>
          {rows.map((r) => (
            <linearGradient key={r.cohortKey} id={`${gradientId}-${r.cohortKey}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" style={{ stopColor: r.seriesColor, stopOpacity: 0.72 }} />
              <stop offset="100%" style={{ stopColor: r.seriesColor, stopOpacity: 1 }} />
            </linearGradient>
          ))}
        </defs>
        <XAxis type="number" hide domain={[0, "dataMax"]} />
        <YAxis
          type="category"
          dataKey="label"
          width={labelWidth}
          interval={0}
          tickLine={false}
          axisLine={false}
          tick={<BarTick rows={rows} />}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, name, item) => (
                <>
                  <span
                    className="mt-[5px] h-0.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: item?.payload?.seriesColor ?? item?.color }}
                  />
                  <div className="flex flex-1 items-center justify-between gap-3 leading-none">
                    <TooltipSeriesName name={item?.payload?.label ?? name} deprecatedOnly={item?.payload?.deprecatedOnly === true} />
                    <span className="font-medium tabular-nums text-foreground">
                      {formatMetric(Number(value), metric)}
                    </span>
                  </div>
                </>
              )}
            />
          }
        />
        {/* Recharts drops a zero-width bar and its label unless the bar has a custom shape. */}
        <Bar
          dataKey="value"
          shape={(props: BarShapeProps) => <Rectangle {...props} />}
          maxBarSize={20}
          radius={[0, 4, 4, 0]}
          isAnimationActive={animate}
          animationDuration={400}
          animationEasing="ease-out"
          activeBar={{ fillOpacity: 0.85 }}
        >
          {rows.map((r) => (
            <Cell key={r.cohortKey} fill={`url(#${gradientId}-${r.cohortKey})`} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            offset={8}
            formatter={(v) => formatMetric(Number(v), metric)}
            className="tabular-nums"
            style={{ fontSize: 11, fontFamily: "var(--font-sans)", fill: "var(--muted-foreground)" }}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
