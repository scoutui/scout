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
import { DEPRECATED_ONLY, distinctPaths, formatAxisCount, formatDay, formatDayTick, formatMetric, formatPct, moreSeries, sharedPackage, splitCohortLabel } from "@/lib/dashboard-format";

const FIGURE_WIDTH = 1280;
const FIGURE_HEIGHT = 720;

const PAD = 48;
const TITLE_Y = 60;
const SUBTITLE_Y = 94;
const PLOT_TOP = 136;
const FOOTER_Y = FIGURE_HEIGHT - 32;
const LEGEND_BOTTOM = FOOTER_Y - 32;
const LEGEND_COLUMNS = 3;
const LEGEND_ROWS = 3;
const LEGEND_ROW = 26;
const LEGEND_GUTTER = 16;
const LEGEND_GAP = 16;
const Y_LABELS = 56;
const X_LABELS = 36;
const X_LABEL_GAP = 140;
const LABELLED_LINES = 10;
const END_LABEL_LINE = 18;
const LEADER = 28;
const LEADER_START = 7;
const LEADER_BEND = 12;
const LEADER_END = 6;
const NAME_COLUMN = 300;
const VALUE_COLUMN = 96;
const BAR_ROW_MAX = 64;
const BAR_MAX = 36;
/** The size of a bar's name and value, and of a line's end label, in layout units. */
export const BAR_TEXT_SIZE = 15;
const TEXT_GAP = 8;

export type FigurePoint = { x: number; y: number };
export type FigureRect = { x: number; y: number; width: number; height: number };
/** A line of text: `x` is its left edge, right edge or centre as `align` says, and `y` its vertical middle. */
export type FigureText = { text: string; x: number; y: number; align: "left" | "right" | "center"; maxWidth: number };
export type FigureLegendEntry = { label: string; value: string; color: string; x: number; y: number; width: number };
/**
 * A line's name and latest value beside the plot, with `details` on the line beneath: its package when a package won't
 * fit beside its name, and the part of its path that tells it from a line of the same name. A label moved clear of
 * another is joined to its line's end by `leader`, drawn in the line's `color`.
 */
export type FigureEndLabel = { name: FigureText; value: FigureText; details: FigureText[]; color: string; leader: FigurePoint[] | null };
export type FigureMarks =
  | { kind: "lines"; lines: Array<{ color: string; points: FigurePoint[] }>; endLabels: FigureEndLabel[] }
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
  /** How many series the figure leaves unnamed, or null when it names them all. */
  note: FigureText | null;
};

export type ChartFigureInput = {
  title: string;
  config: DashboardConfig;
  view: DashboardView;
  /** The whole chart, when `view` draws only some of its series: each line keeps the colour it has there. */
  whole?: DashboardView;
  host: string;
  exportedAt: Date;
  /** A CSS colour for each chart colour token the chart uses and for each `FigureColorRole`. */
  colors: Record<string, string>;
  /** The width of a bar's name or a line's end label set in the mono face at `BAR_TEXT_SIZE`, in layout units. */
  nameWidth: (name: string) => number;
  /** Each component's path by cohortKey, to tell lines of the same name apart. */
  paths?: Readonly<Record<string, string>> | undefined;
};

/** True when a chart has an image to export: a bar chart with bars, or a trend or stacked chart scanned more than once. */
export function hasFigure(config: DashboardConfig, view: DashboardView): boolean {
  if (isEmptyView(view)) return false;
  if (config.chartType === "bars") return view.kind === "snapshot";
  return (config.chartType === "trend" || config.chartType === "stacked-share") && view.kind === "series" && seriesToRows(view.series).length > 1;
}

/**
 * The layout of a chart's image in 1280 × 720 units, with every colour resolved, or null for a chart `hasFigure`
 * gives no image.
 */
export function chartFigure({ title, config, view, whole = view, host, exportedAt, colors, nameWidth, paths = {} }: ChartFigureInput): ChartFigure | null {
  if (!hasFigure(config, view)) return null;
  const resolve = (key: string): string => {
    const value = colors[key];
    if (value === undefined) throw new Error(`chartFigure needs a colour for ${key}`);
    return value;
  };
  const tokens = chartColors(savedChartCohorts(config.cohorts, drawnChartCohorts(whole)));
  const deprecatedOnly = deprecatedOnlyKeys(config.cohorts);
  const shared = sharedPackage(drawnChartCohorts(view).map((c) => c.label));
  const style = {
    seriesColor: (cohortKey: string) => resolve(tokens.get(cohortKey) ?? cohortKey),
    label: (cohort: { cohortKey: string; label: string }) =>
      exportLabel({ ...cohort, label: shared === null ? cohort.label : splitCohortLabel(cohort.label).name }, deprecatedOnly),
    labelParts: (cohort: { cohortKey: string; label: string }) => {
      const { name, packageName } = splitCohortLabel(cohort.label);
      return [name, ...(shared === null && packageName !== undefined ? [packageName] : []), ...(deprecatedOnly.has(cohort.cohortKey) ? [DEPRECATED_ONLY] : [])];
    },
    paths: (named: ReadonlyArray<{ cohortKey: string; label: string }>) => distinctPaths(named, paths),
    nameWidth,
  };
  const inPackage = (subtitle: string) => (shared === null ? subtitle : `${subtitle} · ${shared}`);
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
    return { ...frame, ...barsLayout(view.points, config.metric, style, inPackage(repo ? `${repo} · latest scan` : "All repos · latest scans")) };
  }
  if (view.kind !== "series") return null;
  const stacked = config.chartType === "stacked-share";
  const layout = stacked ? stackedLayout(view.series, style) : trendLayout(view.series, config.metric, style);
  const range = dateRange(...layout.span);
  return { ...frame, ...layout.figure, subtitle: text(inPackage(`${range} · ${repo ?? reposCovered(view.coverage)}`), PAD, SUBTITLE_Y) };
}

type SeriesStyle = {
  seriesColor: (cohortKey: string) => string;
  label: (cohort: { cohortKey: string; label: string }) => string;
  /** A label's name, then its package and `deprecated only` where the label shows them. */
  labelParts: (cohort: { cohortKey: string; label: string }) => string[];
  /** The part of each series' path that tells it from another of `named` with the same name. */
  paths: (named: ReadonlyArray<{ cohortKey: string; label: string }>) => Map<string, string>;
  nameWidth: (name: string) => number;
};
type Layout = Pick<ChartFigure, "subtitle" | "plot" | "yTicks" | "xLabels" | "marks" | "legend" | "note">;
type SeriesLayout = { figure: Omit<Layout, "subtitle">; span: [string, string] };
type Axes = { plot: FigureRect; yTicks: FigureText[]; xLabels: FigureText[]; times: number[]; xOf: (ts: number) => number; yOf: (v: number) => number };

/** The series in order of their latest value, largest first, each with that value. */
function byLatest(series: CohortSeries[]): Array<{ series: CohortSeries; latest: number }> {
  return series.map((s) => ({ series: s, latest: s.points.at(-1)?.value ?? 0 })).sort((a, b) => b.latest - a.latest);
}

/**
 * A trend's lines, the ten with the highest latest value named at their ends, and how many go unnamed beneath. When
 * any name's package won't fit beside it within NAME_COLUMN, every package goes on the line beneath its name, beside
 * the part of its path that tells it from a line of the same name, and the label column is as wide as its widest line,
 * so no name is cut.
 */
function trendLayout(series: CohortSeries[], metric: "count" | "share", style: SeriesStyle): SeriesLayout {
  const labelled = byLatest(series).slice(0, LABELLED_LINES);
  const paths = style.paths(labelled.map(({ series: s }) => s));
  const parts = labelled.map(({ series: s, latest }) => {
    const [first = "", ...rest] = style.labelParts(s);
    const value = formatMetric(latest, metric);
    const valueWidth = style.nameWidth(value);
    const fits = style.nameWidth([first, ...rest].join(" · ")) + TEXT_GAP + valueWidth <= NAME_COLUMN;
    return { cohortKey: s.cohortKey, first, rest, value, valueWidth, fits };
  });
  const wrapped = parts.some((p) => p.rest.length > 0 && !p.fits);
  const named = parts.map(({ cohortKey, first, rest, value, valueWidth }) => {
    const oneLine = rest.length === 0 || !wrapped;
    const name = oneLine ? [first, ...rest].join(" · ") : first;
    const path = paths.get(cohortKey);
    const detail = [...(oneLine ? [] : rest), ...(path === undefined ? [] : [path])].join(" · ");
    const details = detail === "" ? [] : [detail];
    const nameWidth = style.nameWidth(name);
    const width = Math.max(nameWidth + TEXT_GAP + valueWidth, ...details.map(style.nameWidth));
    return { cohortKey, name, value, details, nameWidth, valueWidth, width };
  });
  const labelWidth = Math.max(...named.map((n) => n.width));
  const unnamed = series.length - named.length;
  const plotBottom = unnamed > 0 ? LEGEND_BOTTOM - LEGEND_ROW - LEGEND_GAP - X_LABELS : LEGEND_BOTTOM - X_LABELS;
  const right = FIGURE_WIDTH - PAD - LEADER - labelWidth;
  const ticks = niceTicks(Math.max(...series.flatMap((s) => s.points.map((p) => p.value))), metric === "share" ? 0.01 : 1);
  const axes = seriesAxes(series, ticks, metric, right, plotBottom);
  const lines = series.map((s) => ({
    color: style.seriesColor(s.cohortKey),
    points: s.points.map((p) => ({ x: axes.xOf(Date.parse(p.t)), y: axes.yOf(p.value) })),
  }));
  const endX = axes.plot.x + axes.plot.width;
  const endY = new Map(series.map((s, i) => [s.cohortKey, lines[i]?.points.at(-1)?.y ?? axes.plot.y]));
  const labelX = endX + LEADER;
  const placed = spread(
    named.map((n) => endY.get(n.cohortKey) ?? axes.plot.y),
    axes.plot.y + axes.plot.height,
    named.map((n) => (1 + n.details.length) * END_LABEL_LINE),
  );
  const endLabels = named
    .map((n, i): FigureEndLabel => {
      const y = endY.get(n.cohortKey) ?? axes.plot.y;
      const labelY = placed[i] ?? y;
      return {
        name: text(n.name, labelX, labelY, "left", n.nameWidth),
        value: text(n.value, labelX + n.nameWidth + TEXT_GAP, labelY, "left", n.valueWidth),
        details: n.details.map((detail, k) => text(detail, labelX, labelY + (k + 1) * END_LABEL_LINE, "left", style.nameWidth(detail))),
        color: style.seriesColor(n.cohortKey),
        leader:
          Math.abs(labelY - y) < 0.5
            ? null
            : [
                { x: endX + LEADER_START, y },
                { x: endX + LEADER_BEND, y },
                { x: labelX - LEADER_END, y: labelY },
              ],
      };
    })
    .sort((a, b) => a.name.y - b.name.y);
  const note = unnamed > 0 ? text(moreSeries(unnamed), PAD, LEGEND_BOTTOM - LEGEND_ROW / 2) : null;
  return { figure: { ...axesFigure(axes), marks: { kind: "lines", lines, endLabels }, legend: [], note }, span: span(axes.times) };
}

/** A stacked chart's bands, with a legend of at most three rows that counts the series it leaves out. */
function stackedLayout(series: CohortSeries[], style: SeriesStyle): SeriesLayout {
  const latestTotal = series.reduce((sum, s) => sum + (s.points.at(-1)?.value ?? 0), 0);
  const { legend, note, top: legendTop } = placeLegend(
    byLatest(series).map(({ series: s, latest }) => ({
      label: style.label(s),
      value: formatPct(latestTotal > 0 ? latest / latestTotal : 0),
      color: style.seriesColor(s.cohortKey),
    })),
  );
  const axes = seriesAxes(series, [0, 0.25, 0.5, 0.75, 1], "share", FIGURE_WIDTH - PAD, legendTop - LEGEND_GAP - X_LABELS);
  const rows = seriesToRows(series);
  const keys = series.map((s) => s.cohortKey);
  const stackedRows = expandRowShares(rows, keys).map((row) => {
    let sum = 0;
    return keys.map((key) => {
      sum += Number(row[key]);
      return sum;
    });
  });
  const edge = (band: number) => axes.times.map((ts, r) => ({ x: axes.xOf(ts), y: axes.yOf(band < 0 ? 0 : (stackedRows[r]?.[band] ?? 0)) }));
  const areas = series.map((s, i) => ({ color: style.seriesColor(s.cohortKey), top: edge(i), bottom: edge(i - 1) }));
  return { figure: { ...axesFigure(axes), marks: { kind: "areas", areas }, legend, note }, span: span(axes.times) };
}

/** The plot between the y-axis labels and `right`, from the top of the plot area down to `bottom`, with its axes. */
function seriesAxes(series: CohortSeries[], ticks: number[], metric: "count" | "share", right: number, bottom: number): Axes {
  const rows = seriesToRows(series);
  const left = PAD + Y_LABELS;
  const plot: FigureRect = { x: left, y: PLOT_TOP, width: right - left, height: bottom - PLOT_TOP };
  const yMax = ticks.at(-1) ?? 1;
  const times = rows.map(({ ts }) => Number(ts));
  const first = times[0] ?? 0;
  const spanMs = (times.at(-1) ?? first) - first || 1;
  const xOf = (ts: number) => plot.x + ((ts - first) / spanMs) * plot.width;
  const yOf = (v: number) => plot.y + plot.height * (1 - v / yMax);
  const yTicks = ticks.map((v) => text(metric === "share" ? `${Math.round(v * 100)}%` : formatAxisCount(v), plot.x - 12, yOf(v), "right", Y_LABELS - 12));
  const days = dayTicks(rows);
  const firstDay = days[0];
  const lastDay = days.at(-1);
  const labelled: number[] = firstDay === undefined ? [] : [firstDay];
  for (const ts of days.slice(1, -1)) {
    const previous = labelled.at(-1) ?? ts;
    if (xOf(ts) - xOf(previous) >= X_LABEL_GAP && xOf(lastDay ?? ts) - xOf(ts) >= X_LABEL_GAP) labelled.push(ts);
  }
  if (firstDay !== undefined && lastDay !== undefined && xOf(lastDay) - xOf(firstDay) >= X_LABEL_GAP) labelled.push(lastDay);
  const xLabels = labelled.map((ts) => text(formatDayTick(ts), xOf(ts), plot.y + plot.height + X_LABELS / 2, "center", X_LABEL_GAP));
  return { plot, yTicks, xLabels, times, xOf, yOf };
}

const axesFigure = ({ plot, yTicks, xLabels }: Axes) => ({ plot, yTicks, xLabels });

function span(times: number[]): [string, string] {
  const first = times[0] ?? 0;
  return [new Date(first).toISOString(), new Date(times.at(-1) ?? first).toISOString()];
}

/**
 * Where to set labels that want to sit at `wanted` heights, each as tall as `heights` says: each at its height, moved
 * down just clear of the one above it, then up just clear of the one below where that would take its last line past
 * `bottom`. In `wanted`'s order.
 */
function spread(wanted: number[], bottom: number, heights: number[]): number[] {
  const order = wanted.map((y, i) => ({ y, i, height: heights[i] ?? END_LABEL_LINE })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) {
    const above = order[k - 1];
    const here = order[k];
    if (above && here) here.y = Math.max(here.y, above.y + above.height);
  }
  const lowest = order.at(-1);
  if (lowest && lowest.y + lowest.height - END_LABEL_LINE > bottom) {
    lowest.y = bottom - (lowest.height - END_LABEL_LINE);
    for (let k = order.length - 2; k >= 0; k--) {
      const here = order[k];
      const below = order[k + 1];
      if (here && below) here.y = Math.min(here.y, below.y - here.height);
    }
  }
  const placed: number[] = [];
  for (const { y, i } of order) placed[i] = y;
  return placed;
}

function barsLayout(points: CohortPoint[], metric: "count" | "share", style: SeriesStyle, subtitle: string): Layout {
  const bars = barOrder(points);
  const names = bars.map((p) => style.label(p));
  const nameColumn = Math.min(NAME_COLUMN, Math.max(...names.map(style.nameWidth)) + 2 * TEXT_GAP);
  const plot: FigureRect = {
    x: PAD + nameColumn,
    y: PLOT_TOP,
    width: FIGURE_WIDTH - PAD - VALUE_COLUMN - (PAD + nameColumn),
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
    note: null,
    marks: {
      kind: "bars",
      bars: bars.map((p, i) => {
        const middle = plot.y + (i + 0.5) * rowHeight;
        const width = (p.value / max) * plot.width;
        return {
          color: style.seriesColor(p.cohortKey),
          rect: { x: plot.x, y: middle - thickness / 2, width, height: thickness },
          name: text(names[i] ?? "", PAD, middle, "left", nameColumn - 2 * TEXT_GAP),
          value: text(formatMetric(p.value, metric), plot.x + width + TEXT_GAP, middle, "left", VALUE_COLUMN - TEXT_GAP),
        };
      }),
    },
  };
}

/** The legend in at most `LEGEND_ROWS` rows: past that many slots, the last one counts the entries left out. */
function placeLegend(entries: Array<{ label: string; value: string; color: string }>): { legend: FigureLegendEntry[]; note: FigureText | null; top: number } {
  const slots = LEGEND_COLUMNS * LEGEND_ROWS;
  const listed = entries.length > slots ? entries.slice(0, slots - 1) : entries;
  const top = LEGEND_BOTTOM - Math.ceil((listed.length + (listed.length < entries.length ? 1 : 0)) / LEGEND_COLUMNS) * LEGEND_ROW;
  const column = (FIGURE_WIDTH - 2 * PAD) / LEGEND_COLUMNS;
  const at = (i: number) => ({ x: PAD + (i % LEGEND_COLUMNS) * column, y: top + Math.floor(i / LEGEND_COLUMNS) * LEGEND_ROW + LEGEND_ROW / 2 });
  const noteAt = at(listed.length);
  return {
    top,
    legend: listed.map((entry, i) => ({ ...entry, ...at(i), width: column - LEGEND_GUTTER })),
    note: listed.length < entries.length ? text(moreSeries(entries.length - listed.length), noteAt.x, noteAt.y, "left", column - LEGEND_GUTTER) : null,
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
