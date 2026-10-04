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
    [
      "a trend: each series' latest value",
      config("trend"),
      trendView,
      "1 Sep – 3 Sep 2026 · 2 repos",
      [
        { label: "@example/web", value: "50", color: "#008080" },
        { label: "Button · @example/ui", value: "125", color: "#7a3fd1" },
      ],
    ],
    [
      "a stacked chart: each series' latest share of the latest total",
      config("stacked-share"),
      stackedView,
      "1 Sep – 3 Sep 2026 · 2 repos",
      [
        { label: "@example/web", value: "25%", color: "#008080" },
        { label: "Button · @example/ui", value: "75%", color: "#7a3fd1" },
      ],
    ],
    ["bars: no legend, since each bar is named", config("bars"), barsView, "All repos · latest scans", []],
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
      "a trend: title, subtitle, axes, legend, end labels and footer",
      config("trend"),
      trendView,
      [
        "1 Sep – 3 Sep 2026 · 2 repos",
        ...["0", "50", "100", "150"],
        ...["1 Sep", "3 Sep"],
        ...["@example/web", "50", "Button · @example/ui", "125"],
        ...["50", "125"],
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

  it("labels the time axis with a few days, each with room for its label", () => {
    const month: CohortSeries[] = [
      { ...web, points: Array.from({ length: 30 }, (_, i) => ({ t: `2026-09-${String(i + 1).padStart(2, "0")}T09:00:00Z`, value: i })) },
    ];
    const { xLabels } = drawn(config("trend"), { kind: "series", series: month, coverage });
    expect(xLabels.length).toBeGreaterThan(2);
    expect(xLabels.length).toBeLessThan(30);
    expect(xLabels[0]?.text).toBe("1 Sep");
    xLabels.slice(1).forEach((label, i) => {
      expect(label.x - (xLabels[i]?.x ?? 0)).toBeGreaterThanOrEqual(label.maxWidth);
    });
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

  const endLabels: Array<[string, number, string[]]> = [
    ["labels each line's end when the labels stand apart", 5, ["50", "5"]],
    ["labels no line's end when two labels would overlap", 49, []],
  ];

  it.each(endLabels)("%s", (_, otherLatest, labels) => {
    const series: CohortSeries[] = [
      { ...web, points: [{ t: MORNING, value: 30 }, { t: LATER, value: 50 }] },
      { ...button, points: [{ t: MORNING, value: 20 }, { t: LATER, value: otherLatest }] },
    ];
    const result = drawn(config("trend"), { kind: "series", series, coverage });
    expect(result.marks.kind === "lines" ? result.marks.endLabels.map((l) => l.text) : null).toEqual(labels);
  });

  const notDrawn: Array<[string, DashboardConfig, DashboardView]> = [
    ["a table chart", config("table"), { kind: "table", points, series: countSeries, coverage }],
    ["a trend given a snapshot", config("trend"), barsView],
    ["a chart with nothing to draw", config("trend"), { kind: "series", series: [], coverage }],
  ];

  it.each(notDrawn)("gives no figure for %s", (_, chartConfig, view) => {
    expect(figure(chartConfig, view)).toBeNull();
  });
});
