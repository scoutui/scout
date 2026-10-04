import type { ChartRange, CohortRole, CohortSelector, CohortSeries, DashboardConfig, DashboardView, RepoCoverage } from "@scoutui/web-shared";
import { ChartRangeSchema, cohortKey } from "@scoutui/web-shared/client";
import { CHART_ORDER, looksAlike, paletteToken } from "@/lib/chart-palette";
import { formatReposAdded } from "@/lib/dashboard-format";
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

const RANGE_MONTHS: Record<Exclude<ChartRange, "all">, number> = { "3m": 3, "6m": 6, "1y": 12 };

/** A range named in a link's `range` parameter, or null when it names none. */
export function chartRange(raw: string | readonly string[] | undefined): ChartRange | null {
  const parsed = ChartRangeSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Where `range` starts, in epoch ms, counting back from the latest point of any series.
 * Null for All, and when every point already falls inside the range.
 */
export function rangeStart(series: CohortSeries[], range: ChartRange): number | null {
  if (range === "all") return null;
  const times = series.flatMap((s) => s.points.map((p) => Date.parse(p.t)));
  if (times.length === 0) return null;
  const start = new Date(Math.max(...times));
  start.setUTCMonth(start.getUTCMonth() - RANGE_MONTHS[range]);
  return Math.min(...times) < start.getTime() ? start.getTime() : null;
}

/** Each series from `from` on. A series with points before `from` starts at `from`, with its value then. */
export function seriesFrom(series: CohortSeries[], from: number): CohortSeries[] {
  return series.map((s) => {
    const before = s.points.filter((p) => Date.parse(p.t) < from);
    const after = s.points.filter((p) => Date.parse(p.t) >= from);
    const carried = before[before.length - 1];
    const onEdge = after[0] !== undefined && Date.parse(after[0].t) === from;
    return { ...s, points: carried && !onEdge ? [{ t: new Date(from).toISOString(), value: carried.value }, ...after] : after };
  });
}

/**
 * The view a chart draws at `range`, and where its x-axis starts. A trend or stacked chart draws each series from the
 * range's start on; any other chart draws its whole view.
 */
export function visibleView<V extends DashboardView>(config: DashboardConfig, view: V, range: ChartRange): { view: V; from: number | null } {
  if ((config.chartType !== "trend" && config.chartType !== "stacked-share") || view.kind !== "series") return { view, from: null };
  const from = rangeStart(view.series, range);
  return { view: from === null ? view : { ...view, series: seriesFrom(view.series, from) }, from };
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

/** "3 of 4 repos": how many repos the point at `ts` covers, or null when the chart covers one repo. */
export function repoCoverageAt(coverage: RepoCoverage, ts: number): string | null {
  if (coverage.total <= 1) return null;
  const point = coverage.points.find((p) => Date.parse(p.t) === ts);
  return point ? `${point.repos} of ${coverage.total} repos` : null;
}

/** The times at which a repo joins each line after the line's first point, by cohortKey. */
export function lineJoins(series: CohortSeries[]): Map<string, Set<string>> {
  return new Map(series.map((s) => [s.cohortKey, new Set(s.points.slice(1).filter((p) => p.added?.length).map((p) => p.t))]));
}

/** "checkout added", "checkout and storefront added" or "3 repos added": the repos joining a line at `ts` after its first point. */
export function reposJoiningAt(series: CohortSeries[], ts: number): string | null {
  const repos = [...new Set(series.flatMap((s) => s.points.slice(1).filter((p) => Date.parse(p.t) === ts).flatMap((p) => p.added ?? [])))].sort();
  if (repos.length === 0) return null;
  return repos.length <= 2 ? `${repos.join(" and ")} added` : formatReposAdded(repos.length);
}

/** True when the latest point is a repo's first scan, so the change since the point before is that repo arriving. */
export function repoAddedAtLatest(coverage: RepoCoverage): boolean {
  const [previous, latest] = coverage.points.slice(-2);
  return previous !== undefined && latest !== undefined && latest.repos > previous.repos;
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

export function deprecatedOnlyKeys(selectors: CohortSelector[]): ReadonlySet<string> {
  return new Set(
    selectors
      .filter((s) => (s.kind === "package" || s.kind === "tag") && s.deprecatedOnly === true)
      .map(cohortKey),
  );
}

export const NO_KEYS: ReadonlySet<string> = new Set();

export type ChartCohort = { cohortKey: string; color: string; role?: CohortRole | undefined };

/** Bars in the order the bar chart draws them: largest value first. */
export function barOrder<T extends { value: number }>(bars: T[]): T[] {
  return [...bars].sort((a, b) => b.value - a.value);
}

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
    if (colors.has(c.cohortKey)) continue;
    const own = paletteToken(c.color);
    if (own && isFree(own)) colors.set(c.cohortKey, own);
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
    const pick = CHART_ORDER.find((o) => !neighbours.some((n) => looksAlike(n, o))) ?? CHART_ORDER[0];
    if (pick) colors.set(c.cohortKey, pick);
  });
  return colors;
}

function fixedColor(c: ChartCohort): string | undefined {
  if (c.role === "deprecated") return "var(--viz-deprecated)";
  if (c.role === "successor") return "var(--viz-primary)";
  if (c.cohortKey === "local") return "var(--viz-local)";
  return undefined;
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
