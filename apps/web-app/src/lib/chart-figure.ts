import type { CohortPoint, CohortSeries, DashboardConfig, DashboardView, RepoCoverage } from "@scoutui/web-shared";
import { exportLabel } from "@/lib/chart-export";
import {
  barOrder,
  chartColors,
  dayTicks,
  deprecatedOnlyKeys,
  drawnChartCohorts,
  expandRowShares,
  isEmptyView,
  savedChartCohorts,
  seriesToRows,
} from "@/lib/dashboard-chart-data";
import { formatAxisCount, formatDay, formatDayTick, formatMetric, formatPct } from "@/lib/dashboard-format";

const FIGURE_WIDTH = 1280;
const FIGURE_HEIGHT = 720;

const PAD = 48;
const TITLE_Y = 60;
const SUBTITLE_Y = 94;
const PLOT_TOP = 136;
const FOOTER_Y = FIGURE_HEIGHT - 32;
const LEGEND_BOTTOM = FOOTER_Y - 32;
const LEGEND_COLUMNS = 3;
const LEGEND_ROW = 26;
const LEGEND_GUTTER = 16;
const LEGEND_GAP = 16;
const Y_LABELS = 56;
const X_LABELS = 36;
const X_LABEL_GAP = 140;
const END_LABELS = 80;
const END_LABEL_OFFSET = 10;
const END_LABEL_LINE = 18;
const NAME_COLUMN = 300;
const VALUE_COLUMN = 96;
const BAR_ROW_MAX = 48;
const BAR_MAX = 24;
const TEXT_GAP = 8;

export type FigurePoint = { x: number; y: number };
export type FigureRect = { x: number; y: number; width: number; height: number };
/** A line of text: `x` is its left edge, right edge or centre as `align` says, and `y` its vertical middle. */
export type FigureText = { text: string; x: number; y: number; align: "left" | "right" | "center"; maxWidth: number };
export type FigureLegendEntry = { label: string; value: string; color: string; x: number; y: number; width: number };
export type FigureMarks =
  | { kind: "lines"; lines: Array<{ color: string; points: FigurePoint[] }>; endLabels: Array<FigureText & { color: string }> }
  | { kind: "areas"; areas: Array<{ color: string; top: FigurePoint[]; bottom: FigurePoint[] }> }
  | { kind: "bars"; bars: Array<{ color: string; rect: FigureRect; name: FigureText; value: FigureText }> };
export type FigureColorRole = "background" | "ink" | "muted" | "grid";

export type ChartFigure = {
  width: number;
  height: number;
  palette: Record<FigureColorRole, string>;
  title: FigureText;
  subtitle: FigureText;
  footer: FigureText;
  plot: FigureRect;
  yTicks: FigureText[];
  xLabels: FigureText[];
  marks: FigureMarks;
  legend: FigureLegendEntry[];
};

export type ChartFigureInput = {
  title: string;
  config: DashboardConfig;
  view: DashboardView;
  host: string;
  exportedAt: Date;
  /** A CSS colour for each chart colour token the chart uses and for each `FigureColorRole`. */
  colors: Record<string, string>;
};

/**
 * The layout of a chart's image in 1280 × 720 units, with every colour resolved, or null for a
 * table chart or a chart with nothing to draw.
 */
export function chartFigure({ title, config, view, host, exportedAt, colors }: ChartFigureInput): ChartFigure | null {
  if (isEmptyView(view)) return null;
  const resolve = (key: string): string => {
    const value = colors[key];
    if (value === undefined) throw new Error(`chartFigure needs a colour for ${key}`);
    return value;
  };
  const tokens = chartColors(savedChartCohorts(config.cohorts, drawnChartCohorts(view)));
  const style = {
    seriesColor: (cohortKey: string) => resolve(tokens.get(cohortKey) ?? cohortKey),
    deprecatedOnly: deprecatedOnlyKeys(config.cohorts),
  };
  const frame = {
    width: FIGURE_WIDTH,
    height: FIGURE_HEIGHT,
    palette: { background: resolve("background"), ink: resolve("ink"), muted: resolve("muted"), grid: resolve("grid") },
    title: text(title, PAD, TITLE_Y),
    footer: text(`Scout · ${host} · exported ${exportDate(exportedAt)}`, PAD, FOOTER_Y),
  };
  const repo = config.scope.kind === "repo" ? config.scope.repoId : null;
  if (config.chartType === "bars") {
    if (view.kind !== "snapshot") return null;
    return { ...frame, ...barsLayout(view.points, config.metric, style, repo ? `${repo} · latest scan` : "All repos · latest scans") };
  }
  if (view.kind !== "series") return null;
  const stacked = config.chartType === "stacked-share";
  return { ...frame, ...seriesLayout(view.series, stacked ? "share" : config.metric, stacked, style, repo ?? reposCovered(view.coverage)) };
}

type SeriesStyle = { seriesColor: (cohortKey: string) => string; deprecatedOnly: ReadonlySet<string> };
type Layout = Pick<ChartFigure, "subtitle" | "plot" | "yTicks" | "xLabels" | "marks" | "legend">;

function seriesLayout(series: CohortSeries[], metric: "count" | "share", stacked: boolean, style: SeriesStyle, coverage: string): Layout {
  const rows = seriesToRows(series);
  const latest = series.map((s) => s.points.at(-1)?.value ?? 0);
  const latestTotal = latest.reduce((sum, v) => sum + v, 0);
  const { legend, top: legendTop } = placeLegend(
    series.map((s, i) => ({
      label: exportLabel(s, style.deprecatedOnly),
      value: stacked ? formatPct(latestTotal > 0 ? (latest[i] ?? 0) / latestTotal : 0) : formatMetric(latest[i] ?? 0, metric),
      color: style.seriesColor(s.cohortKey),
    })),
  );
  const left = PAD + Y_LABELS;
  const plot: FigureRect = {
    x: left,
    y: PLOT_TOP,
    width: FIGURE_WIDTH - PAD - (stacked ? 0 : END_LABELS) - left,
    height: legendTop - LEGEND_GAP - X_LABELS - PLOT_TOP,
  };
  const ticks = stacked ? [0, 0.25, 0.5, 0.75, 1] : niceTicks(Math.max(...series.flatMap((s) => s.points.map((p) => p.value))), metric === "share" ? 0.01 : 1);
  const yMax = ticks.at(-1) ?? 1;
  const times = rows.map(({ ts }) => Number(ts));
  const first = times[0] ?? 0;
  const last = times.at(-1) ?? first;
  const span = last - first || 1;
  const xOf = (ts: number) => plot.x + ((ts - first) / span) * plot.width;
  const yOf = (v: number) => plot.y + plot.height * (1 - v / yMax);

  const yTicks = ticks.map((v) => text(metric === "share" ? `${Math.round(v * 100)}%` : formatAxisCount(v), plot.x - 12, yOf(v), "right", Y_LABELS - 12));
  const xLabels: FigureText[] = [];
  for (const ts of dayTicks(rows)) {
    const previous = xLabels.at(-1);
    if (previous === undefined || xOf(ts) - previous.x >= X_LABEL_GAP) {
      xLabels.push(text(formatDayTick(ts), xOf(ts), plot.y + plot.height + X_LABELS / 2, "center", X_LABEL_GAP));
    }
  }

  let marks: FigureMarks;
  if (stacked) {
    const keys = series.map((s) => s.cohortKey);
    const stackedRows = expandRowShares(rows, keys).map((row) => {
      let sum = 0;
      return keys.map((key) => {
        sum += Number(row[key]);
        return sum;
      });
    });
    const edge = (band: number) => times.map((ts, r) => ({ x: xOf(ts), y: yOf(band < 0 ? 0 : (stackedRows[r]?.[band] ?? 0)) }));
    marks = { kind: "areas", areas: series.map((s, i) => ({ color: style.seriesColor(s.cohortKey), top: edge(i), bottom: edge(i - 1) })) };
  } else {
    const lines = series.map((s) => ({
      color: style.seriesColor(s.cohortKey),
      points: s.points.map((p) => ({ x: xOf(Date.parse(p.t)), y: yOf(p.value) })),
    }));
    const ends = lines.flatMap((line, i) => {
      const end = line.points.at(-1);
      const value = formatMetric(latest[i] ?? 0, metric);
      return end ? [{ ...text(value, end.x + END_LABEL_OFFSET, end.y, "left", END_LABELS - END_LABEL_OFFSET), color: line.color }] : [];
    });
    const ys = ends.map((e) => e.y).sort((a, b) => a - b);
    const collide = ys.some((y, i) => i > 0 && y - (ys[i - 1] ?? y) < END_LABEL_LINE);
    marks = { kind: "lines", lines, endLabels: collide ? [] : ends };
  }
  const range = dateRange(new Date(first).toISOString(), new Date(last).toISOString());
  return { subtitle: text(`${range} · ${coverage}`, PAD, SUBTITLE_Y), plot, yTicks, xLabels, marks, legend };
}

function barsLayout(points: CohortPoint[], metric: "count" | "share", style: SeriesStyle, subtitle: string): Layout {
  const bars = barOrder(points);
  const plot: FigureRect = {
    x: PAD + NAME_COLUMN,
    y: PLOT_TOP,
    width: FIGURE_WIDTH - PAD - VALUE_COLUMN - (PAD + NAME_COLUMN),
    height: LEGEND_BOTTOM - PLOT_TOP,
  };
  const rowHeight = Math.min(BAR_ROW_MAX, plot.height / bars.length);
  const thickness = Math.min(BAR_MAX, rowHeight * 0.6);
  const max = Math.max(...bars.map((p) => p.value)) || 1;
  return {
    subtitle: text(subtitle, PAD, SUBTITLE_Y),
    plot,
    yTicks: [],
    xLabels: [],
    legend: [],
    marks: {
      kind: "bars",
      bars: bars.map((p, i) => {
        const middle = plot.y + (i + 0.5) * rowHeight;
        const width = (p.value / max) * plot.width;
        return {
          color: style.seriesColor(p.cohortKey),
          rect: { x: plot.x, y: middle - thickness / 2, width, height: thickness },
          name: text(exportLabel(p, style.deprecatedOnly), PAD, middle, "left", NAME_COLUMN - 2 * TEXT_GAP),
          value: text(formatMetric(p.value, metric), plot.x + width + TEXT_GAP, middle, "left", VALUE_COLUMN - TEXT_GAP),
        };
      }),
    },
  };
}

function placeLegend(entries: Array<{ label: string; value: string; color: string }>): { legend: FigureLegendEntry[]; top: number } {
  const top = LEGEND_BOTTOM - Math.ceil(entries.length / LEGEND_COLUMNS) * LEGEND_ROW;
  const column = (FIGURE_WIDTH - 2 * PAD) / LEGEND_COLUMNS;
  return {
    top,
    legend: entries.map((entry, i) => ({
      ...entry,
      x: PAD + (i % LEGEND_COLUMNS) * column,
      y: top + Math.floor(i / LEGEND_COLUMNS) * LEGEND_ROW + LEGEND_ROW / 2,
      width: column - LEGEND_GUTTER,
    })),
  };
}

function niceTicks(max: number, minStep: number): number[] {
  const rough = Math.max(max, minStep) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(minStep, ([1, 2, 5, 10].find((m) => m * magnitude >= rough) ?? 10) * magnitude);
  return Array.from({ length: Math.max(1, Math.ceil(max / step)) + 1 }, (_, i) => i * step);
}

function dateRange(first: string, last: string): string {
  const [fromYear, toYear] = [first.slice(0, 4), last.slice(0, 4)];
  if (fromYear !== toYear) return `${formatDay(first)} ${fromYear} – ${formatDay(last)} ${toYear}`;
  if (first.slice(0, 10) === last.slice(0, 10)) return `${formatDay(last)} ${toYear}`;
  return `${formatDay(first)} – ${formatDay(last)} ${toYear}`;
}

function reposCovered(coverage: RepoCoverage): string {
  return coverage.total === 1 ? "1 repo" : `${coverage.total} repos`;
}

function exportDate(date: Date): string {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${formatDay(day)} ${date.getFullYear()}`;
}

function text(value: string, x: number, y: number, align: FigureText["align"] = "left", maxWidth = FIGURE_WIDTH - 2 * PAD): FigureText {
  return { text: value, x, y, align, maxWidth };
}
