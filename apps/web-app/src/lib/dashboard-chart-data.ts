import type { CohortRole, CohortSelector, CohortSeries, DashboardView } from "@scoutui/web-shared";
import { cohortKey } from "@scoutui/web-shared/client";
import { CHART_ORDER, looksAlike, paletteToken } from "@/lib/chart-palette";
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
 * ChartConfig keyed by cohortKey, labels only. Charts set each stroke and fill to
 * its `chartColors` value directly, not through `var(--color-<key>)`, because
 * cohort keys contain `:` and `/`, which break generated CSS custom properties.
 */
export function cohortChartConfig(cohorts: Array<{ cohortKey: string; label: string }>): ChartConfig {
  return Object.fromEntries(cohorts.map((c) => [c.cohortKey, { label: c.label }]));
}

export type ChartCohort = { cohortKey: string; color: string; role?: CohortRole | undefined };

/** The cohorts a view draws, in the view's order. */
export function drawnChartCohorts(view: DashboardView): Array<ChartCohort & { label: string }> {
  return view.kind === "series" ? view.series : view.points;
}

/**
 * A chart's saved cohorts in saved order, each with the colour and role of its
 * drawn cohort. A saved cohort the view doesn't draw keeps its place with no colour.
 * Drawn cohorts that no selector names, such as a governance chart's deprecated
 * and successor series, follow in drawn order.
 */
export function savedChartCohorts(selectors: CohortSelector[], drawn: ChartCohort[]): ChartCohort[] {
  const byKey = new Map(drawn.map((c) => [c.cohortKey, c]));
  const saved = selectors.map((selector) => {
    const key = cohortKey(selector);
    return byKey.get(key) ?? { cohortKey: key, color: "" };
  });
  const named = new Set(saved.map((c) => c.cohortKey));
  return [...saved, ...drawn.filter((c) => !named.has(c.cohortKey))];
}

/**
 * Each cohort's line colour, by cohortKey. Fixed meanings come first: deprecated
 * is orange, successor teal and Local grey. Then each tag, in order, keeps its
 * colour unless a colour already placed looks like it. Every other cohort takes
 * the first chart colour that looks like none already placed or, when none is
 * left, the first that looks like neither neighbour.
 */
export function chartColors(cohorts: ChartCohort[]): Map<string, string> {
  const colors = new Map<string, string>();
  const isFree = (color: string) => ![...colors.values()].some((placed) => looksAlike(placed, color));
  for (const c of cohorts) {
    const fixed = fixedColor(c);
    if (fixed) colors.set(c.cohortKey, fixed);
  }
  for (const c of cohorts) {
    if (colors.has(c.cohortKey) || !c.color) continue;
    const own = paletteToken(c.color);
    if (isFree(own)) colors.set(c.cohortKey, own);
  }
  for (const c of cohorts) {
    if (colors.has(c.cohortKey)) continue;
    const free = CHART_ORDER.find(isFree);
    if (free) colors.set(c.cohortKey, free);
  }
  cohorts.forEach((c, i) => {
    if (colors.has(c.cohortKey)) return;
    const neighbours = [cohorts[i - 1], cohorts[i + 1]].flatMap((n) => {
      const color = n ? colors.get(n.cohortKey) : undefined;
      return color ? [color] : [];
    });
    colors.set(c.cohortKey, CHART_ORDER.find((o) => !neighbours.some((n) => looksAlike(n, o))) ?? CHART_ORDER[0]);
  });
  return colors;
}

function fixedColor(c: ChartCohort): string | undefined {
  if (c.role === "deprecated") return "var(--viz-deprecated)";
  if (c.role === "successor") return "var(--viz-primary)";
  if (c.cohortKey === "local") return "var(--viz-local)";
  return undefined;
}

const DASH_STEPS = [undefined, "5 4", "2 3", "8 3 2 3"] as const;

/**
 * Dash step per series: the Nth series sharing a fixed meaning (two deprecated
 * lines, two successor lines) gets the Nth dash pattern, since both must wear
 * that meaning's colour. Every other series has a colour of its own and stays
 * solid. Clamped at the last step.
 */
export function seriesDashes(series: Array<{ role?: CohortRole | undefined }>): Array<string | undefined> {
  const used = new Map<CohortRole, number>();
  return series.map((s) => {
    if (!s.role) return undefined;
    const n = used.get(s.role) ?? 0;
    used.set(s.role, n + 1);
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
