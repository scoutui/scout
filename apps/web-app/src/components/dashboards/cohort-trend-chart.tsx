"use client";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, DefaultZIndexes, type InverseScaleFunction, type MouseHandlerDataParam, type ScaleFunction, type TooltipContentProps, XAxis, YAxis, ZIndexLayer, usePlotArea, useXAxisScale, useYAxisInverseScale, useYAxisScale } from "recharts";
import type { CohortRole, CohortSeries, RepoCoverage } from "@scoutui/web-shared";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { labelMoved, spread } from "@/lib/chart-figure";
import { NO_KEYS, cohortChartConfig, dayTicks, lineJoins, scanDetail, seriesToRows, seriesWashes, shownSeries, tooltipListScroll, tooltipRowTimestamp, tooltipRows } from "@/lib/dashboard-chart-data";
import { DEPRECATED_ONLY, endLabelLines, formatAxisCount, formatDayTick, formatMetric, formatScanStamp, sharedPackage, splitCohortLabel } from "@/lib/dashboard-format";
import { cn } from "@/lib/utils";
import { CohortLabelText, TooltipSeriesName } from "@/components/dashboards/cohort-label";
import { CohortSwatch } from "@/components/dashboards/cohort-swatch";
import { type SeriesChange, TrendLegendTable } from "@/components/dashboards/trend-legend-table";
import { usePinnedTooltip } from "@/components/dashboards/use-pinned-tooltip";

// Up to this many lines drawn, each line's name sits at its end beside the plot.
const END_LABELS_UP_TO = 4;
// From this many series the legend is a sortable table, unless the chart has each series' change.
const TABLE_LEGEND_FROM = END_LABELS_UP_TO + 1;
// End labels, in px: text size, line height, the widest a name and its package share one line, the gap from the plot
// to a label's key, the key's width and height, the gap after the key, and the room after the text.
const LABEL_SIZE = 11;
const LABEL_LINE = 13;
const LABEL_COLUMN = 240;
const LABEL_START = 18;
const KEY = 16;
const KEY_HEIGHT = 12;
const KEY_GAP = 6;
const LABEL_END = 8;
// The most of the chart's width the end labels take beside the plot.
const LABEL_SHARE = 1 / 3;
// The narrowest the plot gets beside the end labels, the y-axis's width with its margin, and the right margin
// without end labels, in px.
const PLOT_FLOOR = 280;
const Y_AXIS = 48;
const NO_LABELS_MARGIN = 16;
// How near the pointer must be to a line on the plot to light it, in px.
const LINE_REACH = 10;

/**
 * Cohort occurrences (or share) over time. One area per cohort, drawn in on load when motion is allowed and coloured
 * by `colors`: a 2px line, with a gradient wash when
 * `seriesWashes` allows it. Up to END_LABELS_UP_TO lines drawn, each line's full name sits beside the plot at its end,
 * keyed as the legend keys it, while the names take LABEL_SHARE of the chart's width or less and the plot keeps
 * PLOT_FLOOR px; each name is a button that lights its line on hover or
 * focus and shows it on its own when pressed. When no name sits beside the plot, a lit line's name sits at its end inside
 * it. Hovering a line on the plot, or its legend entry, lights it and dims the rest. A crosshair tooltip lists the series
 * at that scan, and a click or tap on the plot pins it there, as `usePinnedTooltip` describes. A small ring marks each
 * scan where a repo joins a line. From TABLE_LEGEND_FROM series the legend is a table of each
 * series' latest value; with `change`, it is that table from two series, with each series' change since
 * `change.since`. `paths` tells same-named components apart there and at the lines' ends. With no table, a row of names
 * under the chart names the lines when the names can't sit beside it. A search in the table draws only the series it
 * matches; with `onQueryChange`, the search is `query`, and with `onShownChange`, the line shown on its own is `shown`.
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
  change,
  paths,
  query: shownQuery,
  onQueryChange,
  shown: shownProp,
  onShownChange,
}: {
  series: CohortSeries[];
  coverage: RepoCoverage;
  colors: ReadonlyMap<string, string>;
  deprecatedOnly?: ReadonlySet<string>;
  metric: "count" | "share";
  showLegend?: boolean;
  from?: number | null;
  change?: SeriesChange | undefined;
  paths?: Readonly<Record<string, string>> | undefined;
  query?: string | undefined;
  onQueryChange?: ((query: string) => void) | undefined;
  shown?: string | null | undefined;
  onShownChange?: ((cohortKey: string | null) => void) | undefined;
}) {
  // Gate the draw-in animation on the user's motion preference.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    setAnimate(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  const [hovered, setHovered] = useState<string | null>(null);
  const [ownShown, setOwnShown] = useState<string | null>(null);
  const shown = shownProp === undefined ? ownShown : shownProp;
  const setShown = onShownChange ?? setOwnShown;
  const [lineHovered, setLineHovered] = useState<string | null>(null);
  const yScale = useRef<YScales | undefined>(undefined);
  const [ownQuery, setOwnQuery] = useState("");
  const query = shownQuery ?? ownQuery;
  const setQuery = onQueryChange ?? setOwnQuery;
  const gradientId = useId();
  const pin = usePinnedTooltip();

  const rows = useMemo(() => seriesToRows(allSeries), [allSeries]);
  const ticks = useMemo(() => dayTicks(rows).filter((t) => from === null || t >= from), [rows, from]);
  const [width, setWidth] = useState<number | null>(null);
  const box = useCallback((el: HTMLDivElement | null) => {
    if (el === null) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? null));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Measures the end labels again once the page's mono face has loaded.
  const [, setFontLoaded] = useState(false);
  useEffect(() => {
    document.fonts?.load(labelFont()).then(
      () => {
        measure = undefined;
        setFontLoaded(true);
      },
      () => {},
    );
  }, []);

  if (rows.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Trends appear once these repos have been scanned more than once.
      </p>
    );
  }
  const series = shownSeries(allSeries, query, shown);
  const toggleShown = (key: string) => setShown(shown === key ? null : key);
  const pointed = hovered ?? lineHovered;
  const highlighted = shown === null && series.some((s) => s.cohortKey === pointed) ? pointed : null;
  const lineAt = (state: MouseHandlerDataParam) =>
    state.activeTooltipIndex == null ? null : nearestLine(rows[Number(state.activeTooltipIndex)], series.map((s) => s.cohortKey), yScale.current, state.activeCoordinate?.y);
  const config = cohortChartConfig(allSeries);
  const shared = sharedPackage(allSeries.map((s) => s.label));
  const lastTByKey = new Map(series.map((s) => [s.cohortKey, s.points[s.points.length - 1]?.t]));
  const joins = lineJoins(series);
  // `seriesWashes` decides which series get the wash, here and in the sparkline.
  const washes = seriesWashes(series);
  // Up to END_LABELS_UP_TO lines drawn, each line's name sits beside the plot at its end, once the chart has measured
  // its width and while the names take LABEL_SHARE of it or less and the plot keeps PLOT_FLOOR px.
  const labelRoom = width === null ? 0 : width * LABEL_SHARE;
  const named =
    width !== null && series.length <= END_LABELS_UP_TO
      ? endLabelLines(series, {
          shared,
          deprecatedOnly,
          paths: paths ?? {},
          column: Math.min(LABEL_COLUMN, labelRoom - LABEL_START - KEY - KEY_GAP - LABEL_END),
          width: (parts) => textWidth(parts.join(" ")),
          beside: () => 0,
        })
      : [];
  const column = width === null ? 0 : Math.max(0, ...named.flatMap(({ lines }) => lines.map((line) => textWidth(line.join(" ")))));
  const labelSpace = LABEL_START + KEY + KEY_GAP + column + LABEL_END;
  const beside = width !== null && named.length > 0 && labelSpace <= labelRoom && width - Y_AXIS - labelSpace >= PLOT_FLOOR;
  const table = showLegend && allSeries.length >= (change ? 2 : TABLE_LEGEND_FROM);
  const chips = showLegend && !table && allSeries.length > 1 && width !== null && !beside;
  const ends = named.map(({ cohortKey, lines }) => {
    const s = series.find((x) => x.cohortKey === cohortKey);
    const end = s?.points.at(-1);
    return { cohortKey, role: s?.role, color: colors.get(cohortKey) ?? "", ts: Date.parse(end?.t ?? ""), value: end?.value ?? 0, lines };
  });
  const lit = beside || highlighted === null ? undefined : series.find((s) => s.cohortKey === highlighted);
  const litText = lit
    ? endLabelLines([lit], { shared, deprecatedOnly, paths: {}, column: Number.POSITIVE_INFINITY, width: () => 0, beside: () => 0 })[0]?.lines.flat().join(" ")
    : undefined;

  return (
    <div ref={box} className="@container">
      <ChartContainer ref={pin.ref} onKeyDown={pin.onKeyDown} config={config} className={cn("h-[280px] w-full", pin.className)}>
        <AreaChart
          data={rows}
          margin={{ left: 8, right: beside ? labelSpace : NO_LABELS_MARGIN, top: 12, bottom: 4 }}
          onMouseMove={(state) => setLineHovered(lineAt(state))}
          onMouseLeave={() => setLineHovered(null)}
          onClick={pin.onClick}
        >
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
            interval="preserveStartEnd"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => (metric === "share" ? `${Math.round(v * 100)}%` : formatAxisCount(v))}
            tick={{ fontSize: 11, fontFamily: "var(--font-sans)", fill: "var(--faint)" }}
          />
          <ScaleProbe into={yScale} />
          <ChartTooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            isAnimationActive={false}
            trigger={pin.pinned ? "click" : "hover"}
            wrapperStyle={{ zIndex: 10, pointerEvents: pin.pinned ? "auto" : "none" }}
            content={(props) => (
              <ScanTooltip
                {...props}
                from={from}
                coverage={coverage}
                series={series}
                config={config}
                shared={shared}
                deprecatedOnly={deprecatedOnly}
                pinned={pin.pinned}
                format={(value) => formatMetric(value, metric)}
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
                name={s.cohortKey}
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
                  // A single end-dot (with a surface ring) marks the line's tail.
                  const { cx, cy, payload } = props;
                  if (cx != null && cy != null && payload?.t !== lastTByKey.get(s.cohortKey) && joins.get(s.cohortKey)?.has(payload?.t ?? "")) {
                    return <JoinMarker key={`${s.cohortKey}-join-${payload?.t}`} cx={cx} cy={cy} color={color} dimmed={dimmed} />;
                  }
                  if (cx == null || cy == null || payload?.t !== lastTByKey.get(s.cohortKey)) return <g key={`${s.cohortKey}-none-${props.cx}`} />;
                  return (
                    <circle
                      key={`${s.cohortKey}-end`}
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill={color}
                      stroke="var(--card)"
                      strokeWidth={2}
                      opacity={dimmed ? 0.25 : 1}
                      className="transition-opacity duration-200"
                    />
                  );
                }}
                isAnimationActive={animate}
                animationDuration={400}
                animationEasing="ease-out"
              />
            );
          })}
          {beside ? <EndLabels labels={ends} shown={shown} dimmed={(key) => highlighted !== null && highlighted !== key} onHover={setHovered} onToggle={toggleShown} /> : null}
          {lit && litText ? <LitName text={litText} ts={Date.parse(lit.points.at(-1)?.t ?? "")} value={lit.points.at(-1)?.value ?? 0} /> : null}
        </AreaChart>
      </ChartContainer>

      {/* Hovering a legend entry highlights its series and dims the rest; clicking
          it shows only that series. A single series needs no legend: the title names it. */}
      {table ? (
        <TrendLegendTable
          series={allSeries}
          colors={colors}
          deprecatedOnly={deprecatedOnly}
          metric={metric}
          change={change}
          paths={paths}
          query={query}
          onQueryChange={setQuery}
          shown={shown}
          onToggle={toggleShown}
          onHover={setHovered}
        />
      ) : chips ? (
        <div className="-mx-1 mt-2 -mb-1 flex flex-wrap items-center">
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
                "inline-flex min-h-6 cursor-pointer items-center gap-1.5 px-2 transition-opacity duration-200 pointer-coarse:min-h-11",
                "rounded-sm",
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

/** A tooltip row's series name, without the package when every series on the chart shares it. */
function seriesName(label: ReactNode, shared: string | null): ReactNode {
  return shared !== null && typeof label === "string" ? splitCohortLabel(label).name : label;
}

type YScales = { y: ScaleFunction; value: InverseScaleFunction };

/** Hands the chart's y scale and its inverse to `into`, for finding the line under the pointer. */
function ScaleProbe({ into }: { into: { current: YScales | undefined } }) {
  const y = useYAxisScale();
  const value = useYAxisInverseScale();
  useEffect(() => {
    into.current = y && value ? { y, value } : undefined;
  }, [into, y, value]);
  return null;
}

/**
 * The line among `keys`, in the chart's order, that the tooltip marks as under the pointer at `y` (`tooltipRows`), when
 * its value in `row` sits within LINE_REACH px of `y`, or null for none. As in the tooltip, a line with no value in `row`
 * takes no part.
 */
function nearestLine(row: Record<string, string | number> | undefined, keys: readonly string[], scales: YScales | undefined, y: number | undefined): string | null {
  if (row === undefined || scales === undefined || y === undefined) return null;
  const { under } = tooltipRows(
    keys.flatMap((key) => {
      const value = row[key];
      return typeof value === "number" && Number.isFinite(value) ? [{ dataKey: key, value }] : [];
    }),
    Number(scales.value(y)),
  );
  const at = typeof under?.value === "number" ? scales.y(under.value) : undefined;
  return under !== undefined && at !== undefined && Math.abs(at - y) <= LINE_REACH ? under.dataKey : null;
}

/** A ring on a line where a repo joins it, in the line's colour on the card surface. */
function JoinMarker({ cx, cy, color, dimmed }: { cx: number; cy: number; color: string; dimmed: boolean }) {
  return <circle cx={cx} cy={cy} r={3} fill="var(--card)" stroke={color} strokeWidth={1.5} opacity={dimmed ? 0.25 : 1} className="transition-opacity duration-200" />;
}

type EndLabel = { cohortKey: string; role: CohortRole | undefined; color: string; ts: number; value: number; lines: string[][] };

/** The chart's x and y scales and its plot area, or null until the chart has them. */
function usePlotScales() {
  const x = useXAxisScale();
  const y = useYAxisScale();
  const plot = usePlotArea();
  return x && y && plot ? { x, y, plot } : null;
}

/**
 * Each label beside the plot at its line's end, moved down or up just clear of the others, keyed as the legend keys
 * its line. A label that moved is joined to its line's end by a leader in the line's colour. Each label is a button:
 * hovering or focusing it lights its line, and clicking it, Enter or Space shows that line on its own.
 */
function EndLabels({
  labels,
  shown,
  dimmed,
  onHover,
  onToggle,
}: {
  labels: EndLabel[];
  shown: string | null;
  dimmed: (cohortKey: string) => boolean;
  onHover: (cohortKey: string | null) => void;
  onToggle: (cohortKey: string) => void;
}) {
  const scales = usePlotScales();
  if (!scales) return null;
  const { x, y, plot } = scales;
  const ends = labels.map((label) => ({ ...label, cx: x(label.ts) ?? 0, cy: y(label.value) ?? 0 }));
  const placed = spread(
    ends.map((end) => end.cy),
    plot.y + plot.height,
    ends.map((end) => end.lines.length * LABEL_LINE),
    LABEL_LINE,
  );
  const left = plot.x + plot.width + LABEL_START;
  return (
    <g>
      {ends.map((end, i) => {
        const top = placed[i] ?? end.cy;
        const parts = end.lines.flat();
        return (
          <g
            key={end.cohortKey}
            // biome-ignore lint/a11y/useSemanticElements: a label inside the chart's SVG can't be a <button> element
            role="button"
            tabIndex={0}
            aria-pressed={shown === end.cohortKey}
            aria-label={[...parts, ...(end.role === "deprecated" && !parts.includes(DEPRECATED_ONLY) ? ["deprecated"] : [])].join(" ")}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(end.cohortKey);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggle(end.cohortKey);
              }
            }}
            onMouseEnter={() => onHover(end.cohortKey)}
            onMouseLeave={() => onHover(null)}
            onFocus={(event) => {
              event.stopPropagation();
              onHover(end.cohortKey);
            }}
            onBlur={(event) => {
              event.stopPropagation();
              onHover(null);
            }}
            opacity={dimmed(end.cohortKey) ? 0.25 : 1}
            className="cursor-pointer transition-opacity duration-200"
          >
            {labelMoved(end.cy, top) ? (
              <polyline points={`${end.cx + 6},${end.cy} ${end.cx + 10},${end.cy} ${left - 4},${top}`} fill="none" stroke={end.color} strokeWidth={1} />
            ) : null}
            <foreignObject x={left} y={top - KEY_HEIGHT / 2} width={KEY} height={KEY_HEIGHT}>
              <div className="flex h-full items-center">
                <CohortSwatch cohortKey={end.cohortKey} color={end.color} role={end.role} />
              </div>
            </foreignObject>
            {end.lines.map((line, n) => (
              <text key={line.join(" ")} x={left + KEY + KEY_GAP} y={top + n * LABEL_LINE} dy="0.35em" fontSize={LABEL_SIZE} fontFamily="var(--font-mono)">
                {line.map((part, p) => (
                  <tspan key={part} fill={n === 0 && p === 0 ? "var(--muted-foreground)" : "var(--faint)"} fontFamily={part === DEPRECATED_ONLY ? "var(--font-sans)" : undefined}>
                    {p > 0 ? ` ${part}` : part}
                  </tspan>
                ))}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
}

/** `text` at a lit line's end inside the plot, above the line unless that leaves the plot, over a halo in the card's colour. */
function LitName({ text, ts, value }: { text: string; ts: number; value: number }) {
  const scales = usePlotScales();
  if (!scales) return null;
  const { x, y, plot } = scales;
  const cx = x(ts) ?? 0;
  const cy = y(value) ?? 0;
  const above = cy - 2 * LABEL_LINE >= plot.y;
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.area + 2}>
      <text
        x={cx - 8}
        y={above ? cy - LABEL_LINE : cy + LABEL_LINE}
        dy="0.35em"
        textAnchor="end"
        fontSize={LABEL_SIZE}
        fontFamily="var(--font-mono)"
        fill="var(--foreground)"
        stroke="var(--card)"
        strokeWidth={4}
        strokeLinejoin="round"
        paintOrder="stroke"
        pointerEvents="none"
      >
        {text}
      </text>
    </ZIndexLayer>
  );
}

let measure: OffscreenCanvasRenderingContext2D | null | undefined;

/** The page's mono face at LABEL_SIZE, as a CSS font. */
function labelFont(): string {
  return `${LABEL_SIZE}px ${getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace"}`;
}

/** The width of `text` in px, set in the page's mono face at LABEL_SIZE, or 0.6 of LABEL_SIZE a character where nothing can measure it. */
function textWidth(text: string): number {
  if (measure === undefined) {
    measure = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("2d");
    if (measure) measure.font = labelFont();
  }
  return measure ? measure.measureText(text).width : text.length * LABEL_SIZE * 0.6;
}

/**
 * A chart over time's tooltip at the hovered scan, headed by `scanTooltipLabel`, with a row for every series. Past
 * eleven rows the list scrolls and fades at an edge with rows beyond it, and the row under the pointer, as `tooltipRows`
 * finds it among the series in `series`' order, is bold and kept in view. `pinned`, the list stays where it is scrolled
 * once it shows that row, and the tooltip's edge darkens. With `stack`, the series are bands stacked in that order.
 * `format` sets each value.
 */
export function ScanTooltip({
  active,
  payload,
  label,
  coordinate,
  from,
  coverage,
  series,
  config,
  shared,
  deprecatedOnly,
  format,
  stack,
  pinned = false,
}: Pick<TooltipContentProps, "active" | "payload" | "label" | "coordinate"> & {
  from: number | null;
  coverage: RepoCoverage;
  series: CohortSeries[];
  config: ChartConfig;
  shared: string | null;
  deprecatedOnly: ReadonlySet<string>;
  format: (value: number) => string;
  stack?: readonly string[];
  pinned?: boolean;
}) {
  const toValue = useYAxisInverseScale();
  const at = coordinate === undefined || toValue === undefined ? undefined : Number(toValue(coordinate.y));
  const order = new Map(series.map((s, i) => [s.cohortKey, i]));
  const inOrder = payload && [...payload].sort((a, b) => (order.get(String(a.dataKey)) ?? 0) - (order.get(String(b.dataKey)) ?? 0));
  const { rows, under } = tooltipRows(inOrder, at, stack);
  const anchor = useRef<HTMLDivElement>(null);
  const placedPinned = useRef(false);
  useEffect(() => {
    const row = anchor.current?.parentElement;
    const list = row?.parentElement;
    if (!row || !list) return;
    const place = (rowTop?: number) => {
      const { scrollTop, above, below, scrollbarRoom } = tooltipListScroll({
        scrollTop: list.scrollTop,
        height: list.clientHeight,
        content: list.scrollHeight,
        pitch: row.offsetHeight + Number.parseFloat(getComputedStyle(list).rowGap),
        scrollbar: list.offsetWidth - list.clientWidth,
        rowTop,
      });
      if (list.scrollTop !== scrollTop) list.scrollTop = scrollTop;
      list.toggleAttribute("data-scrollbar-room", scrollbarRoom);
      list.style.maskImage = `linear-gradient(to bottom, transparent, #000 ${above ? "1rem" : "0px"}, #000 calc(100% - ${below ? "1rem" : "0px"}), transparent)`;
    };
    place(under === undefined || (pinned && placedPinned.current) ? undefined : row.offsetTop - list.offsetTop);
    placedPinned.current = pinned;
    const onScroll = () => place();
    list.addEventListener("scroll", onScroll);
    return () => list.removeEventListener("scroll", onScroll);
  });
  return (
    <ChartTooltipContent
      active={active && tooltipRowTimestamp(payload) !== from}
      payload={rows}
      label={label}
      className={cn(
        "[&>div:last-child]:max-h-[12rem] [&>div:last-child]:overflow-y-auto [&>div:last-child]:overscroll-contain [&>div:last-child[data-scrollbar-room]]:pe-4",
        pinned && "border-foreground/30",
      )}
      labelFormatter={(_, rows) => scanTooltipLabel(rows, coverage, series)}
      formatter={(value, name, item) => (
        <>
          <span className="mt-[5px] h-0.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item?.color }} />
          <div ref={item === (under ?? rows[0]) ? anchor : undefined} className="flex min-w-0 flex-1 items-center justify-between gap-3 leading-none">
            <TooltipSeriesName name={seriesName(config[String(name)]?.label ?? name, shared)} deprecatedOnly={deprecatedOnly.has(String(name))} marked={item === under} />
            <span className={cn("overflow-clip tabular-nums text-foreground", item === under ? "font-semibold" : "font-medium")}>{format(Number(value))}</span>
          </div>
        </>
      )}
    />
  );
}

/**
 * A tooltip's heading: the scan time, and beneath it how many repos the point covers when the chart covers more than
 * one, and which repos join `series` there.
 */
function scanTooltipLabel(payload: ReadonlyArray<{ payload?: unknown }> | undefined, coverage: RepoCoverage, series: CohortSeries[]): ReactNode {
  const ts = tooltipRowTimestamp(payload);
  if (ts === null) return "";
  const detail = scanDetail(coverage, series, ts);
  return (
    <>
      {formatScanStamp(ts)}
      {detail ? <span className="block font-normal text-muted-foreground">{detail}</span> : null}
    </>
  );
}
