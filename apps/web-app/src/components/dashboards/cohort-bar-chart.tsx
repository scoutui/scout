"use client";
import { useEffect, useId, useState } from "react";
import { Bar, BarChart, type BarShapeProps, Cell, LabelList, Rectangle, XAxis, YAxis } from "recharts";
import type { CohortPoint } from "@scoutui/web-shared";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cohortChartConfig, } from "@/lib/dashboard-chart-data";
import { barRowLabel, formatMetric } from "@/lib/dashboard-format";

// Each row label renders on two lines: the name, then its package (or a package's
// scope) muted beneath. SVG text can't truncate, so the lines take hard character
// caps; the tooltip carries the full label.
const ATTR_CAP = 38;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function tickLines(label: string): { name: string; attribution: string } {
  const { name, attribution } = barRowLabel(label);
  return { name, attribution: clip(attribution ?? "", ATTR_CAP) };
}

function BarTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value?: unknown } }) {
  const { name, attribution } = tickLines(String(payload?.value ?? ""));
  return (
    <text x={x} y={y} textAnchor="end" fontFamily="var(--font-mono)">
      {attribution.length > 0 ? (
        <>
          <tspan x={x} dy={-2} fontSize={11} fill="var(--foreground)">
            {name}
          </tspan>
          <tspan x={x} dy={12} fontSize={10} fill="var(--muted-foreground)">
            {attribution}
          </tspan>
        </>
      ) : (
        <tspan x={x} dy={4} fontSize={11} fill="var(--muted-foreground)">
          {name}
        </tspan>
      )}
    </text>
  );
}

// Per-row band height: a bar of at most 20px in a 36px band.
const ROW_PX = 36;

/**
 * One horizontal bar per cohort at the latest scan, with the value at the bar's tip.
 * Rows sort by value; colour follows the cohort and is assigned before the sort. Bars
 * are at most 20px thick, rounded 4px at the tip, and grow in on load when motion is
 * allowed. Every value is labelled, so the numeric axis and gridlines are off.
 */
export function CohortBarChart({
  points,
  colors,
  metric,
}: {
  points: CohortPoint[];
  colors: ReadonlyMap<string, string>;
  metric: "count" | "share";
}) {
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    setAnimate(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  const gradientId = useId();

  const rows = points
    .map((p) => ({ cohortKey: p.cohortKey, label: p.label, value: p.value, seriesColor: colors.get(p.cohortKey) ?? "" }))
    .sort((a, b) => b.value - a.value);
  const config = cohortChartConfig(points);

  const lines = rows.map((r) => tickLines(r.label));
  const labelWidth = Math.min(
    240,
    16 + Math.max(...lines.map((l) => Math.max(l.name.length * 6.6, l.attribution.length * 6))),
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
          tick={<BarTick />}
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
                    <span className="font-mono text-muted-foreground">{item?.payload?.label ?? name}</span>
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
