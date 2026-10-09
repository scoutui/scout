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
  lineColors,
  savedChartCohorts,
  seriesToRows,
} from "@/lib/dashboard-chart-data";
import { type EndLabelLines, endLabelLines, formatAxisCount, formatDay, formatDayTick, formatMetric, formatPct, sharedPackage, splitCohortLabel } from "@/lib/dashboard-format";

const FIGURE_WIDTH = 1280;
const FIGURE_HEIGHT = 720;

const PAD = 48;
const TITLE_Y = 60;
const TITLE_LINE = 38;
const SUBTITLE_Y = 94;
const SUBTITLE_LINE = 24;
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
const BAR_ROW_MIN = 2 * BAR_TEXT_SIZE;
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
  /** The title, one entry per line. */
  title: FigureText[];
  /** The subtitle, one entry per line. */
  subtitle: FigureText[];
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
  /** The whole chart, when `view` draws only some of its series: each line keeps the colour it has there. */
  whole?: DashboardView;
  host: string;
  exportedAt: Date;
  /** A CSS colour for each chart colour token the chart uses and for each `FigureColorRole`. */
  colors: Record<string, string>;
  /** The width of a bar's name or a line's end label set in the mono face at `BAR_TEXT_SIZE`, in layout units. */
  nameWidth: (name: string) => number;
  /** The width of a line of the title or the subtitle set in its own face, in layout units. */
  headingWidth: (text: string, kind: "title" | "subtitle") => number;
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
 * The layout of a chart's image in 1280 × 720 units, or taller for a bar chart whose bars need more room, with every
 * colour resolved, or null for a chart `hasFigure` gives no image. A title or subtitle too wide for one line wraps, and
 * the image grows taller by the lines it adds.
 */
export function chartFigure({ title, config, view, whole = view, host, exportedAt, colors, nameWidth, headingWidth, paths = {} }: ChartFigureInput): ChartFigure | null {
  if (!hasFigure(config, view)) return null;
  const resolve = (key: string): string => {
    const value = colors[key];
    if (value === undefined) throw new Error(`chartFigure needs a colour for ${key}`);
    return value;
  };
  const saved = savedChartCohorts(config.cohorts, drawnChartCohorts(whole));
  const tokens =
    whole.kind === "series" ? lineColors(saved) : chartColors(saved);
  const deprecatedOnly = deprecatedOnlyKeys(config.cohorts);
  const shared = sharedPackage(drawnChartCohorts(view).map((c) => c.label));
  const style = {
    seriesColor: (cohortKey: string) => resolve(tokens.get(cohortKey) ?? cohortKey),
    label: (cohort: { cohortKey: string; label: string }) =>
      exportLabel({ ...cohort, label: shared === null ? cohort.label : splitCohortLabel(cohort.label).name }, deprecatedOnly),
    endLabels: (named: ReadonlyArray<{ cohortKey: string; label: string }>, beside: (cohortKey: string) => number) =>
      endLabelLines(named, { shared, deprecatedOnly, paths, column: NAME_COLUMN, width: (parts) => nameWidth(parts.join(" · ")), beside }),
    nameWidth,
  };
  const inPackage = (subtitle: string) => (shared === null ? subtitle : `${subtitle} · ${shared}`);
  const heading = (subtitle: string) => {
    const width = FIGURE_WIDTH - 2 * PAD;
    const titleLines = wrap(title, width, (line) => headingWidth(line, "title"));
    const subtitleY = SUBTITLE_Y + (titleLines.length - 1) * TITLE_LINE;
    const subtitleLines = wrap(subtitle, width, (line) => headingWidth(line, "subtitle"));
    const drop = subtitleY - SUBTITLE_Y + (subtitleLines.length - 1) * SUBTITLE_LINE;
    return {
      frame: {
        width: FIGURE_WIDTH,
        height: FIGURE_HEIGHT + drop,
        palette: { background: resolve("background"), ink: resolve("ink"), muted: resolve("muted"), grid: resolve("grid") },
        title: titleLines.map((line, i) => text(line, PAD, TITLE_Y + i * TITLE_LINE, "left", width)),
        subtitle: subtitleLines.map((line, i) => text(line, PAD, subtitleY + i * SUBTITLE_LINE, "left", width)),
        footer: text(`Scout · ${host} · exported ${exportDate(exportedAt)}`, PAD, FOOTER_Y + drop),
      },
      body: { top: PLOT_TOP + drop, bottom: LEGEND_BOTTOM + drop },
    };
  };
  const repo = config.scope.kind === "repo" ? config.scope.repoId : null;
  if (config.chartType === "bars") {
    if (view.kind !== "snapshot") return null;
    const { frame, body } = heading(inPackage(repo ? `${repo} · latest scan` : "All repos · latest scans"));
    const bars = barsLayout(view.points, config.metric, style, body);
    const grow = bars.plot.height - (body.bottom - body.top);
    return { ...frame, ...bars, height: frame.height + grow, footer: { ...frame.footer, y: frame.footer.y + grow } };
  }
  if (view.kind !== "series") return null;
  const { frame, body } = heading(inPackage(`${dateRange(view.series)} · ${repo ?? reposCovered(view.coverage)}`));
  const stacked = config.chartType === "stacked-share";
  return { ...frame, ...(stacked ? stackedLayout(view.series, style, body) : trendLayout(view.series, config.metric, style, body)) };
}

type SeriesStyle = {
  seriesColor: (cohortKey: string) => string;
  label: (cohort: { cohortKey: string; label: string }) => string;
  /** Each of `named`'s end label as lines of parts, with `beside(cohortKey)` taken beside its first line. */
  endLabels: (named: ReadonlyArray<{ cohortKey: string; label: string }>, beside: (cohortKey: string) => number) => EndLabelLines[];
  nameWidth: (name: string) => number;
};
type Layout = Pick<ChartFigure, "plot" | "yTicks" | "xLabels" | "marks" | "legend">;
/** Where the plot starts, and where the legend below it ends. */
type Body = { top: number; bottom: number };
type Axes = { plot: FigureRect; yTicks: FigureText[]; xLabels: FigureText[]; times: number[]; xOf: (ts: number) => number; yOf: (v: number) => number };

/** The series in order of their latest value, largest first, each with that value. */
function byLatest(series: CohortSeries[]): Array<{ series: CohortSeries; latest: number }> {
  return series.map((s) => ({ series: s, latest: s.points.at(-1)?.value ?? 0 })).sort((a, b) => b.latest - a.latest);
}

/**
 * A trend's lines, with the ten largest named at their ends, largest first. When any name's package won't fit beside it
 * within NAME_COLUMN, every package goes on the line beneath its name, beside the part of its path that tells it from a
 * line of the same name, and the label column is as wide as its widest line, so no name is cut.
 */
function trendLayout(series: CohortSeries[], metric: "count" | "share", style: SeriesStyle, body: Body): Layout {
  const labelled = byLatest(series).slice(0, LABELLED_LINES);
  const values = new Map(labelled.map(({ series: s, latest }) => [s.cohortKey, formatMetric(latest, metric)]));
  const named = style
    .endLabels(
      labelled.map(({ series: s }) => s),
      (cohortKey) => TEXT_GAP + style.nameWidth(values.get(cohortKey) ?? ""),
    )
    .map(({ cohortKey, lines: [first = [], ...beneath] }) => {
      const name = first.join(" · ");
      const value = values.get(cohortKey) ?? "";
      const nameWidth = style.nameWidth(name);
      const valueWidth = style.nameWidth(value);
      const details = beneath.map((line) => line.join(" · "));
      return { cohortKey, name, value, details, nameWidth, valueWidth, width: Math.max(nameWidth + TEXT_GAP + valueWidth, ...details.map(style.nameWidth)) };
    });
  const labelWidth = Math.max(...named.map((n) => n.width));
  const plotBottom = body.bottom - X_LABELS;
  const right = FIGURE_WIDTH - PAD - LEADER - labelWidth;
  const ticks = niceTicks(Math.max(...series.flatMap((s) => s.points.map((p) => p.value))), metric === "share" ? 0.01 : 1);
  const axes = seriesAxes(series, ticks, metric, right, body.top, plotBottom);
  const pointsOf = new Map(series.map((s) => [s.cohortKey, s.points.map((p) => ({ x: axes.xOf(Date.parse(p.t)), y: axes.yOf(p.value) }))]));
  const lines = series.map((s) => ({ color: style.seriesColor(s.cohortKey), points: pointsOf.get(s.cohortKey) ?? [] }));
  const endX = axes.plot.x + axes.plot.width;
  const endY = new Map([...pointsOf].map(([cohortKey, points]) => [cohortKey, points.at(-1)?.y ?? axes.plot.y]));
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
        leader: labelMoved(y, labelY)
          ? [
              { x: endX + LEADER_START, y },
              { x: endX + LEADER_BEND, y },
              { x: labelX - LEADER_END, y: labelY },
            ]
          : null,
      };
    })
    .sort((a, b) => a.name.y - b.name.y);
  return { ...axesFigure(axes), marks: { kind: "lines", lines, endLabels }, legend: [] };
}

/** A stacked chart's bands, with a legend of the LABELLED_LINES largest. */
function stackedLayout(series: CohortSeries[], style: SeriesStyle, body: Body): Layout {
  const latestTotal = series.reduce((sum, s) => sum + (s.points.at(-1)?.value ?? 0), 0);
  const { legend, top: legendTop } = placeLegend(
    byLatest(series).map(({ series: s, latest }) => ({
      label: style.label(s),
      value: formatPct(latestTotal > 0 ? latest / latestTotal : 0),
      color: style.seriesColor(s.cohortKey),
    })),
    body.bottom,
  );
  const axes = seriesAxes(series, [0, 0.25, 0.5, 0.75, 1], "share", FIGURE_WIDTH - PAD, body.top, legendTop - LEGEND_GAP - X_LABELS);
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
  return { ...axesFigure(axes), marks: { kind: "areas", areas }, legend };
}

/** The plot between the y-axis labels and `right`, from `top` down to `bottom`, with its axes. */
function seriesAxes(series: CohortSeries[], ticks: number[], metric: "count" | "share", right: number, top: number, bottom: number): Axes {
  const rows = seriesToRows(series);
  const left = PAD + Y_LABELS;
  const plot: FigureRect = { x: left, y: top, width: right - left, height: bottom - top };
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

/**
 * Where to set labels that want to sit at `wanted` heights, each as tall as `heights` says: each at its height, moved
 * down just clear of the one above it, then up just clear of the one below where that would take its last line, `line`
 * high, past `bottom`. In `wanted`'s order.
 */
export function spread(wanted: number[], bottom: number, heights: number[], line = END_LABEL_LINE): number[] {
  const order = wanted.map((y, i) => ({ y, i, height: heights[i] ?? line })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) {
    const above = order[k - 1];
    const here = order[k];
    if (above && here) here.y = Math.max(here.y, above.y + above.height);
  }
  const lowest = order.at(-1);
  if (lowest && lowest.y + lowest.height - line > bottom) {
    lowest.y = bottom - (lowest.height - line);
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

/** Whether a label placed at `placed` moved from `wanted`. */
export function labelMoved(wanted: number, placed: number): boolean {
  return Math.abs(placed - wanted) >= 0.5;
}

/** A bar chart's layout. Its plot fills `body`, and grows past it so that every bar's row is at least `BAR_ROW_MIN` tall. */
function barsLayout(points: CohortPoint[], metric: "count" | "share", style: SeriesStyle, body: Body): Layout {
  const bars = barOrder(points);
  const names = bars.map((p) => style.label(p));
  const nameColumn = Math.min(NAME_COLUMN, Math.max(...names.map(style.nameWidth)) + 2 * TEXT_GAP);
  const plot: FigureRect = {
    x: PAD + nameColumn,
    y: body.top,
    width: FIGURE_WIDTH - PAD - VALUE_COLUMN - (PAD + nameColumn),
    height: Math.max(body.bottom - body.top, bars.length * BAR_ROW_MIN),
  };
  const rowHeight = Math.min(BAR_ROW_MAX, plot.height / bars.length);
  const thickness = Math.min(BAR_MAX, rowHeight * 0.6);
  const max = Math.max(...bars.map((p) => p.value)) || 1;
  return {
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
          name: text(names[i] ?? "", PAD, middle, "left", nameColumn - 2 * TEXT_GAP),
          value: text(formatMetric(p.value, metric), plot.x + width + TEXT_GAP, middle, "left", VALUE_COLUMN - TEXT_GAP),
        };
      }),
    },
  };
}

/** The legend of the first LABELLED_LINES entries, in rows of LEGEND_COLUMNS ending at `bottom`. */
function placeLegend(entries: Array<{ label: string; value: string; color: string }>, bottom: number): { legend: FigureLegendEntry[]; top: number } {
  const listed = entries.slice(0, LABELLED_LINES);
  const top = bottom - Math.ceil(listed.length / LEGEND_COLUMNS) * LEGEND_ROW;
  const column = (FIGURE_WIDTH - 2 * PAD) / LEGEND_COLUMNS;
  const at = (i: number) => ({ x: PAD + (i % LEGEND_COLUMNS) * column, y: top + Math.floor(i / LEGEND_COLUMNS) * LEGEND_ROW + LEGEND_ROW / 2 });
  return { top, legend: listed.map((entry, i) => ({ ...entry, ...at(i), width: column - LEGEND_GUTTER })) };
}

function niceTicks(max: number, minStep: number): number[] {
  const rough = Math.max(max, minStep) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(minStep, ([1, 2, 5, 10].find((m) => m * magnitude >= rough) ?? 10) * magnitude);
  return Array.from({ length: Math.max(1, Math.ceil(max / step)) + 1 }, (_, i) => i * step);
}

/** The days a chart's series run from and to. */
function dateRange(series: CohortSeries[]): string {
  const times = seriesToRows(series).map(({ ts }) => Number(ts));
  const first = new Date(times[0] ?? 0).toISOString();
  const last = new Date(times.at(-1) ?? times[0] ?? 0).toISOString();
  const [fromYear, toYear] = [first.slice(0, 4), last.slice(0, 4)];
  if (fromYear !== toYear) return `${formatDay(first)} ${fromYear} – ${formatDay(last)} ${toYear}`;
  if (first.slice(0, 10) === last.slice(0, 10)) return `${formatDay(last)} ${toYear}`;
  return `${formatDay(first)} – ${formatDay(last)} ${toYear}`;
}

function reposCovered(coverage: RepoCoverage): string {
  const [only] = coverage.repoIds;
  return coverage.total === 1 && only !== undefined ? only : `${coverage.total} repos`;
}

/** `value` in lines no wider than `width`, broken at spaces, and inside a word only where the word alone is wider. */
function wrap(value: string, width: number, measure: (line: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(" ")) {
    const joined = line === "" ? word : `${line} ${word}`;
    if (measure(joined) <= width) {
      line = joined;
      continue;
    }
    if (line !== "") lines.push(line);
    line = word;
    while (line.length > 1 && measure(line) > width) {
      let end = line.length - 1;
      while (end > 1 && measure(line.slice(0, end)) > width) end--;
      lines.push(line.slice(0, end));
      line = line.slice(end);
    }
  }
  return [...lines, line];
}

function exportDate(date: Date): string {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${formatDay(day)} ${date.getFullYear()}`;
}

function text(value: string, x: number, y: number, align: FigureText["align"] = "left", maxWidth = FIGURE_WIDTH - 2 * PAD): FigureText {
  return { text: value, x, y, align, maxWidth };
}
