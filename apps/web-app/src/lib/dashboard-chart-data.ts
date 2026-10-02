import type { CohortRole, CohortSeries, DashboardView } from "@scoutui/web-shared";
import { identityColor, paletteToken } from "@/lib/chart-palette";
import type { ChartConfig } from "@/components/ui/chart";

/** True when a view has no series to draw. */
export function isEmptyView(view: DashboardView): boolean {
  return (view.kind === "series" ? view.series : view.points).length === 0;
}

/** Pivot cohort series into recharts rows: one row per timestamp, keyed by cohortKey. */
export function seriesToRows(series: CohortSeries[]): Array<Record<string, string | number>> {
  const byT = new Map<string, Record<string, string | number>>();
  for (const s of series) {
    for (const p of s.points) {
      const row = byT.get(p.t) ?? { t: p.t, ts: Date.parse(p.t) };
      row[s.cohortKey] = p.value;
      byT.set(p.t, row);
    }
  }
  // Sort by the map key (the timestamp): reading `.t` off each row would need
  // bracket notation, which the linter flags.
  return [...byT.entries()].sort(([ka], [kb]) => ka.localeCompare(kb)).map(([, row]) => row);
}

/** One x tick per distinct day (the day's first scan), in epoch ms for the numeric time axis. */
export function dayTicks(rows: Array<Record<string, string | number>>): number[] {
  const seen = new Set<string>();
  const ticks: number[] = [];
  for (const row of rows) {
    // biome-ignore lint/complexity/useLiteralKeys: index-signature access requires bracket notation (noPropertyAccessFromIndexSignature)
    const t = String(row["t"] ?? "");
    // biome-ignore lint/complexity/useLiteralKeys: index-signature access requires bracket notation (noPropertyAccessFromIndexSignature)
    const ts = Number(row["ts"] ?? Number.NaN);
    const day = t.slice(0, 10);
    if (!seen.has(day) && Number.isFinite(ts)) {
      seen.add(day);
      ticks.push(ts);
    }
  }
  return ticks;
}

/**
 * Reads the epoch-ms `ts` off the hovered or focused tooltip row, for the numeric
 * time axis. Once the x-axis is numeric, shadcn's `ChartTooltipContent` passes
 * `labelFormatter` a cohort's label (`itemConfig?.label`), not the axis value
 * (the `typeof label === "string"` branch in chart.tsx only fires for a category
 * axis), so the timestamp comes from the hovered row, `payload[0].payload`.
 * Returns `null` when the row is missing or malformed.
 */
export function tooltipRowTimestamp(payload: ReadonlyArray<{ payload?: unknown }> | undefined): number | null {
  const row = payload?.[0]?.payload as Record<string, unknown> | undefined;
  // biome-ignore lint/complexity/useLiteralKeys: index-signature access requires bracket notation (noPropertyAccessFromIndexSignature)
  const ts = Number(row?.["ts"]);
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Rescales each row's cohort values to fractions of that row's own total, as
 * recharts' `stackOffset="expand"` would. Done by hand because recharts (3.8.0)
 * applies the `expand` domain to every axis, not just the stacked one:
 * `combineAxisDomain` in `recharts/es6/state/selectors/axisSelectors.js` returns
 * `[0, 1]` even over an explicit numeric domain, which collapses the epoch-ms
 * x-axis and pushes the plot off the canvas.
 */
export function expandRowShares(
  rows: Array<Record<string, string | number>>,
  cohortKeys: string[],
): Array<Record<string, string | number>> {
  return rows.map((row) => {
    const total = cohortKeys.reduce((sum, key) => sum + (Number(row[key]) || 0), 0);
    const next: Record<string, string | number> = { ...row };
    for (const key of cohortKeys) {
      next[key] = total > 0 ? Number(row[key] ?? 0) / total : 0;
    }
    return next;
  });
}

/**
 * The literal stroke and fill colour for a cohort. Recharts gets the colour
 * directly, not through `var(--color-<key>)`, because cohort keys contain `:` and
 * `/`, which break generated CSS custom properties.
 *
 * A governance role (from web-shared) wins, then an authored tag colour, then
 * a lighter grey for `local` (the off-system cohort), then the identity
 * rotation. Green is kept for the progress readout and never colours a series:
 * red next to green is the classic colour-blindness trap.
 */
export function cohortColor(cohort: { cohortKey: string; color: string; role?: CohortRole | undefined }, index: number): string {
  if (cohort.role === "deprecated") return "var(--viz-deprecated)";
  if (cohort.role === "successor") return "var(--viz-primary)";
  if (cohort.color) return paletteToken(cohort.color);
  if (cohort.cohortKey === "local") return "var(--viz-local)";
  return identityColor(index);
}

/** ChartConfig keyed by cohortKey, labels only. Colour is applied to stroke/fill via cohortColor. */
export function cohortChartConfig(cohorts: Array<{ cohortKey: string; label: string }>): ChartConfig {
  return Object.fromEntries(cohorts.map((c) => [c.cohortKey, { label: c.label }]));
}

/**
 * Dash step per series: the Nth series drawing a colour already in use gets the
 * Nth dash pattern, so two cohorts with the same role, or a wrapped identity
 * rotation, stay distinguishable without changing the hue. Clamped at the last
 * step.
 */
const DASH_STEPS = [undefined, "5 4", "2 3", "8 3 2 3"] as const;
export function seriesDashes(
  series: Array<{ cohortKey: string; color: string; role?: CohortRole | undefined }>,
): Array<string | undefined> {
  const used = new Map<string, number>();
  return series.map((s, i) => {
    const drawn = cohortColor(s, i);
    // Local's grey and the grey tag colour are the same colour in dark mode.
    const colour = drawn === "var(--viz-local)" ? "var(--viz-legacy)" : drawn;
    const n = used.get(colour) ?? 0;
    used.set(colour, n + 1);
    return DASH_STEPS[Math.min(n, DASH_STEPS.length - 1)];
  });
}

/**
 * Which series get the gradient wash under their trend line, in both the overlay
 * chart and the row mini chart. A lone series always does. At 4 or more series
 * none do: overlapping washes turn to mud and look like a stacked area. In
 * between, a deprecated-role series gets none, because over its successor's
 * teal wash it would read as a stacked band of a value nobody plotted.
 */
export function seriesWashes(
  series: Array<{ cohortKey: string; color: string; role?: CohortRole | undefined }>,
): boolean[] {
  if (series.length === 1) return [true];
  if (series.length >= 4) return series.map(() => false);
  return series.map((s) => s.role !== "deprecated");
}

/**
 * Scales a trend-chart dash pattern (an SVG `stroke-dasharray` such as "5 4")
 * down to legend-swatch size, keeping its segment count and proportions so the
 * dash steps look different across a ~16px swatch. The swatch doesn't match the
 * chart line's geometry. An empty or invalid pattern (solid) returns no segments.
 */
export function dashSwatchSegments(pattern: string): number[] {
  const numbers = pattern
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  return numbers.map((n) => Math.max(1, Math.round(n / 2)));
}
