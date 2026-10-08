import { ChartRangeSchema, type ChartRange, type CohortSeries } from "./dto.js";

const RANGE_MONTHS: Record<Exclude<ChartRange, "all">, number> = { "3m": 3, "6m": 6, "1y": 12 };

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

/** The day a chart over time starts at `range`, in epoch ms: where the range starts, or the chart's first point when the range takes in every point. Null for a chart with no points. */
export function chartStart(series: CohortSeries[], range: ChartRange): number | null {
  const times = series.flatMap((s) => s.points.map((p) => Date.parse(p.t)));
  return times.length === 0 ? null : (rangeStart(series, range) ?? Math.min(...times));
}

/** Each series' change by `cohortKey`, at each range a chart offers. */
export type ChangeByRange = Partial<Record<ChartRange, Readonly<Record<string, number | null>>>>;

/** The change `since` measures from the day the chart starts at each range. */
export function changeByRange(series: CohortSeries[], since: (start: number) => Readonly<Record<string, number | null>>): ChangeByRange {
  return Object.fromEntries(
    ChartRangeSchema.options.flatMap((range) => {
      const start = chartStart(series, range);
      return start === null ? [] : [[range, since(start)]];
    }),
  );
}
