import { describe, expect, it } from "vitest";
import type { CohortPoint, CohortSelector, CohortSeries, DashboardConfig, DashboardView } from "@scoutui/web-shared";
import { chartFigure, type ChartFigure } from "@/lib/chart-figure";
import { figureTexts } from "../helpers/figure-texts";

const MORNING = "2026-09-01T09:05:00Z";
const AFTERNOON = "2026-09-01T15:30:00Z";
const LATER = "2026-09-03T08:00:00Z";

const web = { cohortKey: "package:@example/web", label: "@example/web", color: "" };
const button = { cohortKey: "component:btn", label: "Button · @example/ui", color: "" };
const cohorts: CohortSelector[] = [
  { kind: "package", packageName: "@example/web" },
  { kind: "component", componentId: "btn" },
];
const coverage = { total: 2, points: [MORNING, AFTERNOON, LATER].map((t) => ({ t, repos: 2 })) };

const countSeries: CohortSeries[] = [
  { ...web, points: [{ t: MORNING, value: 40 }, { t: AFTERNOON, value: 45 }, { t: LATER, value: 50 }] },
  { ...button, points: [{ t: AFTERNOON, value: 5 }, { t: LATER, value: 125 }] },
];
const shareSeries: CohortSeries[] = [
  { ...web, points: [{ t: MORNING, value: 0.6 }, { t: AFTERNOON, value: 0.3 }, { t: LATER, value: 0.2 }] },
  { ...button, points: [{ t: AFTERNOON, value: 0.1 }, { t: LATER, value: 0.6 }] },
];
const points: CohortPoint[] = [
  { ...web, value: 50, componentCount: 3 },
  { ...button, value: 125, componentCount: 1 },
];

const trendView: DashboardView = { kind: "series", series: countSeries, coverage };
const stackedView: DashboardView = { kind: "series", series: shareSeries, coverage };
const barsView: DashboardView = { kind: "snapshot", points };

const colors: Record<string, string> = {
  "var(--viz-primary)": "#008080",
  "var(--viz-cat-2)": "#7a3fd1",
  "var(--viz-cat-3)": "#1f5fa8",
  "var(--viz-cat-4)": "#b0306a",
  "var(--viz-cat-5)": "#c45bd6",
  "var(--viz-local)": "#b5b8bd",
  "var(--viz-deprecated)": "#d9822b",
  background: "#ffffff",
  ink: "#1c1d20",
  muted: "#5d6067",
  grid: "#e2e3e6",
};

const config = (chartType: DashboardConfig["chartType"], scope: DashboardConfig["scope"] = { kind: "all" }): DashboardConfig => ({
  scope,
  cohorts,
  chartType,
  metric: "count",
});

const figure = (chartConfig: DashboardConfig, view: DashboardView): ChartFigure | null =>
  chartFigure({ title: "Button adoption", config: chartConfig, view, host: "scout.example.com", exportedAt: new Date(2026, 9, 4, 12), colors, nameWidth: (name) => name.length * 9 });

const drawn = (chartConfig: DashboardConfig, view: DashboardView): ChartFigure => {
  const result = figure(chartConfig, view);
  if (result === null) throw new Error("expected a figure");
  return result;
};

describe("chartFigure", () => {
  const cases: Array<[string, DashboardConfig, DashboardView, string, Array<{ label: string; value: string; color: string }>]> = [
    ["a trend: no legend, since its line ends are named", config("trend"), trendView, "1 Sep – 3 Sep 2026 · 2 repos", []],
    [
      "a stacked chart: each series' latest share of the latest total, largest first",
      config("stacked-share"),
      stackedView,
      "1 Sep – 3 Sep 2026 · 2 repos",
      [
        { label: "Button · @example/ui", value: "75%", color: "#7a3fd1" },
        { label: "@example/web", value: "25%", color: "#008080" },
      ],
    ],
    ["bars: no legend", config("bars"), barsView, "All repos · latest scans", []],
  ];

  it.each(cases)("titles, credits and keys %s", (_, chartConfig, view, subtitle, legend) => {
    const result = drawn(chartConfig, view);
    expect(result.title.text).toBe("Button adoption");
    expect(result.subtitle.text).toBe(subtitle);
    expect(result.footer.text).toBe("Scout · scout.example.com · exported 4 Oct 2026");
    expect(result.legend.map(({ label, value, color }) => ({ label, value, color }))).toEqual(legend);
  });

  const subtitles: Array<[string, DashboardConfig, DashboardView, string]> = [
    ["names the repo a repo-scoped trend covers", config("trend", { kind: "repo", repoId: "checkout" }), trendView, "1 Sep – 3 Sep 2026 · checkout"],
    ["names the repo repo-scoped bars cover", config("bars", { kind: "repo", repoId: "checkout" }), barsView, "checkout · latest scan"],
    [
      "counts a single repo in the singular",
      config("trend"),
      { kind: "series", series: countSeries, coverage: { ...coverage, total: 1 } },
      "1 Sep – 3 Sep 2026 · 1 repo",
    ],
    [
      "gives both ends their year when the range spans years",
      config("trend"),
      {
        kind: "series",
        series: [{ ...web, points: [{ t: "2025-12-14T10:00:00Z", value: 4 }, { t: "2026-02-02T09:00:00Z", value: 6 }] }],
        coverage,
      },
      "14 Dec 2025 – 2 Feb 2026 · 2 repos",
    ],
    [
      "gives a range within one day as that day",
      config("trend"),
      {
        kind: "series",
        series: [{ ...web, points: [{ t: "2026-10-04T08:00:00Z", value: 4 }, { t: "2026-10-04T15:00:00Z", value: 6 }] }],
        coverage,
      },
      "4 Oct 2026 · 2 repos",
    ],
  ];

  it.each(subtitles)("%s", (_, chartConfig, view, subtitle) => {
    expect(drawn(chartConfig, view).subtitle.text).toBe(subtitle);
  });

  const frameTexts = ["Button adoption", "Scout · scout.example.com · exported 4 Oct 2026"];
  const textCases: Array<[string, DashboardConfig, DashboardView, string[]]> = [
    [
      "a trend: title, subtitle, axes, end labels and footer",
      config("trend"),
      trendView,
      [
        "1 Sep – 3 Sep 2026 · 2 repos",
        ...["0", "50", "100", "150"],
        ...["1 Sep", "3 Sep"],
        ...["@example/web", "50", "Button · @example/ui", "125"],
      ],
    ],
    [
      "a stacked chart: title, subtitle, axes in quarters, legend and footer",
      config("stacked-share"),
      stackedView,
      [
        "1 Sep – 3 Sep 2026 · 2 repos",
        ...["0%", "25%", "50%", "75%", "100%"],
        ...["1 Sep", "3 Sep"],
        ...["@example/web", "25%", "Button · @example/ui", "75%"],
      ],
    ],
    [
      "bars: title, subtitle, each bar's name and value, and footer",
      config("bars"),
      barsView,
      ["All repos · latest scans", ...["Button · @example/ui", "125", "@example/web", "50"]],
    ],
  ];

  it.each(textCases)("holds no other text in %s", (_, chartConfig, view, expected) => {
    expect(figureTexts(drawn(chartConfig, view)).sort()).toEqual([...frameTexts, ...expected].sort());
  });

  it("labels the time axis with its first and last day and a few between, each with room for its label", () => {
    const month: CohortSeries[] = [
      { ...web, points: Array.from({ length: 30 }, (_, i) => ({ t: `2026-09-${String(i + 1).padStart(2, "0")}T09:00:00Z`, value: i })) },
    ];
    const { xLabels } = drawn(config("trend"), { kind: "series", series: month, coverage });
    expect(xLabels.length).toBeGreaterThan(2);
    expect(xLabels.length).toBeLessThan(30);
    expect(xLabels[0]?.text).toBe("1 Sep");
    expect(xLabels.at(-1)?.text).toBe("30 Sep");
    xLabels.slice(1).forEach((label, i) => {
      expect(label.x - (xLabels[i]?.x ?? 0)).toBeGreaterThanOrEqual(label.maxWidth);
    });
  });

  it("gives a line drawn from part of the chart the colour it has in the whole chart", () => {
    const wholeView: DashboardView = { kind: "series", series: countSeries.map((s, i) => (i === 0 ? { ...s, role: "deprecated" as const } : s)), coverage };
    const whole = drawn(config("trend"), wholeView);
    if (whole.marks.kind !== "lines") throw new Error("expected lines");
    const part = chartFigure({
      title: "Button adoption",
      config: config("trend"),
      view: { kind: "series", series: countSeries.slice(1), coverage },
      whole: wholeView,
      host: "scout.example.com",
      exportedAt: new Date(2026, 9, 4, 12),
      colors,
      nameWidth: (name) => name.length * 9,
    });
    if (part?.marks.kind !== "lines") throw new Error("expected lines");
    expect(whole.marks.lines[1]?.color).not.toBe(whole.marks.lines[0]?.color);
    expect(part.marks.lines.map((l) => l.color)).toEqual([whole.marks.lines[1]?.color]);
  });

  it("draws one line per trend series from its own first point, even with six series", () => {
    const six: CohortSeries[] = ["a", "b", "c", "d", "e", "f"].map((name, i) => ({
      cohortKey: `package:@example/${name}`,
      label: `@example/${name}`,
      color: "",
      points: [{ t: MORNING, value: i }, { t: LATER, value: i * 10 }],
    }));
    const sixConfig: DashboardConfig = { ...config("trend"), cohorts: six.map((s) => ({ kind: "package", packageName: s.label })) };
    const result = drawn(sixConfig, { kind: "series", series: six, coverage });
    expect(result.marks.kind === "lines" ? result.marks.lines : []).toHaveLength(6);

    const trend = drawn(config("trend"), trendView);
    if (trend.marks.kind !== "lines") throw new Error("expected lines");
    const [webLine, buttonLine] = trend.marks.lines;
    expect(webLine?.points).toHaveLength(3);
    expect(buttonLine?.points).toHaveLength(2);
    expect(buttonLine?.points[0]?.x).toBe(webLine?.points[1]?.x);
    expect(webLine?.points[0]?.x).toBe(trend.plot.x);
  });

  it("stacks a stacked chart's bands to the top of the plot", () => {
    const result = drawn(config("stacked-share"), stackedView);
    if (result.marks.kind !== "areas") throw new Error("expected areas");
    const [first, last] = result.marks.areas;
    expect(first?.bottom).toHaveLength(3);
    for (const p of first?.bottom ?? []) expect(p.y).toBeCloseTo(result.plot.y + result.plot.height);
    for (const p of last?.top ?? []) expect(p.y).toBeCloseTo(result.plot.y);
    expect(last?.top).toHaveLength(3);
  });

  it("draws bars largest first, each named with its value", () => {
    const result = drawn(config("bars"), barsView);
    if (result.marks.kind !== "bars") throw new Error("expected bars");
    expect(result.marks.bars.map((b) => [b.name.text, b.value.text, b.color])).toEqual([
      ["Button · @example/ui", "125", "#7a3fd1"],
      ["@example/web", "50", "#008080"],
    ]);
    expect(result.marks.bars[1]?.rect.width).toBeCloseTo((result.marks.bars[0]?.rect.width ?? 0) * 0.4);
  });

  const nameColumns: Array<[string, string, number]> = [
    ["just past the longest name", "Button · @example/ui", 20 * 9 + 16],
    ["at most 300 units in, however long the name", "x".repeat(60), 300],
  ];

  it.each(nameColumns)("starts the bars %s", (_, label, gap) => {
    const view: DashboardView = { kind: "snapshot", points: [{ ...button, label, value: 125, componentCount: 1 }] };
    const result = drawn(config("bars"), view);
    if (result.marks.kind !== "bars") throw new Error("expected bars");
    expect(result.plot.x - (result.marks.bars[0]?.name.x ?? 0)).toBe(gap);
  });

  const endLabelTexts = (result: ChartFigure) =>
    result.marks.kind === "lines" ? result.marks.endLabels.map((l) => [l.name.text, l.value.text, ...l.details.map((d) => d.text)]) : null;
  const twoLines = (webLatest: number, buttonLatest: number): DashboardView => ({
    kind: "series",
    series: [
      { ...web, points: [{ t: MORNING, value: 30 }, { t: LATER, value: webLatest }] },
      { ...button, points: [{ t: MORNING, value: 20 }, { t: LATER, value: buttonLatest }] },
    ],
    coverage,
  });

  it("names each line's end with its latest value, top to bottom", () => {
    expect(endLabelTexts(drawn(config("trend"), twoLines(5, 50)))).toEqual([
      ["Button · @example/ui", "50"],
      ["@example/web", "5"],
    ]);
  });

  it("joins no label to its line's end where the label sits level with it", () => {
    const result = drawn(config("trend"), twoLines(5, 50));
    if (result.marks.kind !== "lines") throw new Error("expected lines");
    expect(result.marks.endLabels.map((l) => l.leader)).toEqual([null, null]);
  });

  it("moves a label clear of the one above it and joins only that label to its line's end", () => {
    const result = drawn(config("trend"), twoLines(50, 49));
    if (result.marks.kind !== "lines") throw new Error("expected lines");
    const [upper, lower] = result.marks.endLabels;
    expect(upper?.name.text).toBe("@example/web");
    expect(upper?.leader).toBeNull();
    expect((lower?.name.y ?? 0) - (upper?.name.y ?? 0)).toBeGreaterThanOrEqual(18);
    const end = result.marks.lines[1]?.points.at(-1);
    expect(lower?.leader?.[0]?.y).toBe(end?.y);
    expect(lower?.leader?.at(-1)?.y).toBe(lower?.name.y);
    expect(lower?.value.y).toBe(lower?.name.y);
  });

  it("names every line in full, putting every package on a line of its own when one is too wide to share its name's line", () => {
    const group = { cohortKey: "component:group", label: "ToolbarGroupComponent · @example/richtext-lexical-editor", color: "" };
    const long = { cohortKey: `package:@example/${"x".repeat(40)}`, label: `@example/${"x".repeat(40)}`, color: "" };
    const view: DashboardView = {
      kind: "series",
      series: [
        { ...group, points: [{ t: MORNING, value: 3 }, { t: LATER, value: 50 }] },
        { ...long, points: [{ t: MORNING, value: 1 }, { t: LATER, value: 49 }] },
        { ...button, points: [{ t: MORNING, value: 2 }, { t: LATER, value: 48 }] },
      ],
      coverage,
    };
    const result = drawn(
      { ...config("trend"), cohorts: [{ kind: "component", componentId: "group" }, { kind: "package", packageName: long.label }, { kind: "component", componentId: "btn" }] },
      view,
    );
    expect(endLabelTexts(result)).toEqual([
      ["ToolbarGroupComponent", "50", "@example/richtext-lexical-editor"],
      [long.label, "49"],
      ["Button", "48", "@example/ui"],
    ]);
    if (result.marks.kind !== "lines") throw new Error("expected lines");
    for (const text of result.marks.endLabels.flatMap((l) => [l.name, l.value, ...l.details])) {
      expect(text.maxWidth, text.text).toBeGreaterThanOrEqual(text.text.length * 9);
    }
    const [first, second] = result.marks.endLabels;
    expect((second?.name.y ?? 0) - (first?.name.y ?? 0)).toBeGreaterThanOrEqual(2 * 18);
  });

  it("tells named lines of the same name apart by the part of their component's path that differs", () => {
    const component = (key: string, name: string, latest: number): CohortSeries => ({
      cohortKey: `component:${key}`,
      label: `${name} · @example/web`,
      color: "",
      points: [{ t: MORNING, value: 1 }, { t: LATER, value: latest }],
    });
    const skeletons = (series: CohortSeries[]) => {
      const result = chartFigure({
        title: "Skeletons",
        config: { ...config("trend"), cohorts: series.map((s) => ({ kind: "component", componentId: s.cohortKey.slice("component:".length) })) },
        view: { kind: "series", series, coverage },
        paths: { "component:booking": "src/booking/SkeletonItem.tsx", "component:event-types": "src/event-types/SkeletonItem.tsx" },
        host: "scout.example.com",
        exportedAt: new Date(2026, 9, 4, 12),
        colors,
        nameWidth: (name) => name.length * 9,
      });
      if (result === null) throw new Error("expected a figure");
      return endLabelTexts(result);
    };
    const booking = component("booking", "SkeletonItem", 50);
    const eventTypes = component("event-types", "SkeletonItem", 5);
    expect(skeletons([booking, eventTypes])).toEqual([
      ["SkeletonItem", "50", "booking"],
      ["SkeletonItem", "5", "event-types"],
    ]);
    const others = Array.from({ length: 9 }, (_, i) => component(`other-${i}`, `Skeleton${i}`, 10 + i));
    expect(skeletons([booking, ...others, eventTypes])?.[0]).toEqual(["SkeletonItem", "50"]);
  });

  const many = (n: number): CohortSeries[] =>
    Array.from({ length: n }, (_, i) => ({
      cohortKey: `package:@example/p${i}`,
      label: `@example/p${i}`,
      color: "",
      points: [{ t: MORNING, value: 100 }, { t: LATER, value: i }],
    }));
  const manyConfig = (chartType: DashboardConfig["chartType"], series: CohortSeries[]): DashboardConfig => ({
    ...config(chartType),
    cohorts: series.map((s) => ({ kind: "package", packageName: s.label })),
  });
  const manyFigure = (chartType: DashboardConfig["chartType"], n: number) =>
    drawn(manyConfig(chartType, many(n)), { kind: "series", series: many(n), coverage });

  it("names the ten lines with the highest latest value, apart and inside the plot, and counts the rest under it", () => {
    const result = manyFigure("trend", 12);
    if (result.marks.kind !== "lines") throw new Error("expected lines");
    expect(result.marks.lines).toHaveLength(12);
    expect(result.marks.endLabels.map((l) => l.name.text)).toEqual(Array.from({ length: 10 }, (_, i) => `@example/p${11 - i}`));
    result.marks.endLabels.slice(1).forEach((label, i) => {
      expect(label.name.y - (result.marks.kind === "lines" ? (result.marks.endLabels[i]?.name.y ?? 0) : 0)).toBeGreaterThanOrEqual(18);
    });
    for (const label of result.marks.endLabels) {
      expect(label.name.y).toBeGreaterThanOrEqual(result.plot.y);
      expect(label.name.y).toBeLessThanOrEqual(result.plot.y + result.plot.height);
    }
    expect(result.note?.text).toBe("2 more series");
    expect(result.note?.y).toBeGreaterThan(result.plot.y + result.plot.height);
  });

  it("names ten same-named lines from long packages inside the plot, each with its package and path on one line beneath", () => {
    const packageOf = (i: number) => (i % 2 === 0 ? "@example/a-package-too-long-to-share-a-line" : "@example/another-package-too-long-for-one");
    const tall: CohortSeries[] = Array.from({ length: 10 }, (_, i) => ({
      cohortKey: `component:c${i}`,
      label: `SkeletonItem · ${packageOf(i)}`,
      color: "",
      points: [{ t: MORNING, value: 1 }, { t: LATER, value: 20 - i }],
    }));
    const result = chartFigure({
      title: "Skeletons",
      config: { ...config("trend"), cohorts: tall.map((s) => ({ kind: "component", componentId: s.cohortKey.slice("component:".length) })) },
      view: { kind: "series", series: tall, coverage },
      paths: Object.fromEntries(tall.map((s, i) => [s.cohortKey, `src/folder-${i}/SkeletonItem.tsx`])),
      host: "scout.example.com",
      exportedAt: new Date(2026, 9, 4, 12),
      colors,
      nameWidth: (name) => name.length * 9,
    });
    if (result?.marks.kind !== "lines") throw new Error("expected lines");
    expect(endLabelTexts(result)).toEqual(Array.from({ length: 10 }, (_, i) => ["SkeletonItem", `${20 - i}`, `${packageOf(i)} · folder-${i}`]));
    for (const text of result.marks.endLabels.flatMap((l) => [l.name, ...l.details])) {
      expect(text.y).toBeGreaterThanOrEqual(result.plot.y);
      expect(text.y).toBeLessThanOrEqual(result.plot.y + result.plot.height);
    }
  });

  it("lists a stacked chart's eight largest series and counts the rest", () => {
    const result = manyFigure("stacked-share", 12);
    expect(result.legend.map((e) => e.label)).toEqual(Array.from({ length: 8 }, (_, i) => `@example/p${11 - i}`));
    expect(result.note?.text).toBe("4 more series");
  });

  it.each([["trend", 12] as const, ["stacked-share", 10] as const])("keeps a %s chart's plot as tall with 50 series as with %i", (chartType, fewer) => {
    expect(manyFigure(chartType, 50).plot.height).toBe(manyFigure(chartType, fewer).plot.height);
  });

  it.each([["trend"] as const, ["bars"] as const])("names a package every series shares once, in a %s chart's subtitle", (chartType) => {
    const card = { cohortKey: "component:card", label: "Card · @example/ui", color: "" };
    const shared: DashboardConfig = { ...config(chartType), cohorts: [{ kind: "component", componentId: "btn" }, { kind: "component", componentId: "card" }] };
    const view: DashboardView =
      chartType === "bars"
        ? { kind: "snapshot", points: [{ ...button, value: 125, componentCount: 1 }, { ...card, value: 40, componentCount: 1 }] }
        : {
            kind: "series",
            series: [
              { ...button, points: [{ t: MORNING, value: 5 }, { t: LATER, value: 125 }] },
              { ...card, points: [{ t: MORNING, value: 30 }, { t: LATER, value: 40 }] },
            ],
            coverage,
          };
    const result = drawn(shared, view);
    expect(result.subtitle.text).toMatch(/ · @example\/ui$/);
    const names = result.marks.kind === "lines" ? result.marks.endLabels.map((l) => l.name.text) : result.marks.kind === "bars" ? result.marks.bars.map((b) => b.name.text) : [];
    expect(names).toEqual(["Button", "Card"]);
  });

  const scannedOnce: CohortSeries[] = countSeries.map((s) => ({ ...s, points: s.points.slice(-1) }));
  const notDrawn: Array<[string, DashboardConfig, DashboardView]> = [
    ["a table chart", config("table"), { kind: "table", points, series: countSeries, coverage, change: {} }],
    ["a trend given a snapshot", config("trend"), barsView],
    ["a chart with nothing to draw", config("trend"), { kind: "series", series: [], coverage }],
    ["a trend scanned once", config("trend"), { kind: "series", series: scannedOnce, coverage }],
    ["a stacked chart scanned once", config("stacked-share"), { kind: "series", series: scannedOnce, coverage }],
  ];

  it.each(notDrawn)("gives no figure for %s", (_, chartConfig, view) => {
    expect(figure(chartConfig, view)).toBeNull();
  });
});
