import { describe, expect, it } from "vitest";
import type { CohortPoint, CohortSelector, CohortSeries, DashboardConfig, DashboardView } from "@scoutui/web-shared";
import { chartExportTable, exportFileName, toCsv, toTsv, type ExportTable } from "@/lib/chart-export";

const MORNING = "2026-09-01T09:05:00Z";
const AFTERNOON = "2026-09-01T15:30:00Z";
const LATER = "2026-09-03T08:00:00.000Z";

const web = { cohortKey: "package:@example/web", label: "@example/web", color: "" };
const button = { cohortKey: "component:btn", label: "Button · @example/ui", color: "" };
const cohorts: CohortSelector[] = [
  { kind: "package", packageName: "@example/web" },
  { kind: "component", componentId: "btn" },
];

const coverage = { total: 2, points: [MORNING, AFTERNOON, LATER].map((t) => ({ t, repos: 2 })) };

const countSeries: CohortSeries[] = [
  { ...web, points: [{ t: MORNING, value: 40 }, { t: AFTERNOON, value: 45 }, { t: LATER, value: 50 }] },
  { ...button, points: [{ t: AFTERNOON, value: 5 }, { t: LATER, value: 1250 }] },
];
const shareSeries: CohortSeries[] = [
  { ...web, points: [{ t: MORNING, value: 1 }, { t: AFTERNOON, value: 0.405 }, { t: LATER, value: 0.0004 }] },
  { ...button, points: [{ t: AFTERNOON, value: 0.595 }, { t: LATER, value: 0.9996 }] },
];
const stackedSeries: CohortSeries[] = [
  { ...web, points: [{ t: MORNING, value: 0.6 }, { t: AFTERNOON, value: 0.3 }, { t: LATER, value: 0.2 }] },
  { ...button, points: [{ t: AFTERNOON, value: 0.1 }, { t: LATER, value: 0.6 }] },
];
const countPoints: CohortPoint[] = [
  { ...web, value: 50, componentCount: 3 },
  { ...button, value: 1250, componentCount: 1 },
];
const sharePoints: CohortPoint[] = [
  { ...web, value: 0.25, componentCount: 3 },
  { ...button, value: 0.75, componentCount: 1 },
];

const config = (chartType: DashboardConfig["chartType"], metric: DashboardConfig["metric"]): DashboardConfig => ({
  scope: { kind: "all" },
  cohorts,
  chartType,
  metric,
});

const timeColumns = ["Committed (UTC)", "@example/web", "Button · @example/ui"];

describe("chartExportTable", () => {
  const cases: Array<[string, DashboardConfig, DashboardView, ExportTable]> = [
    [
      "a trend of counts: one row per scan, a blank before a series starts, plain integers",
      config("trend", "count"),
      { kind: "series", series: countSeries, coverage },
      {
        columns: timeColumns,
        rows: [
          ["2026-09-01 09:05", "40", ""],
          ["2026-09-01 15:30", "45", "5"],
          ["2026-09-03 08:00", "50", "1250"],
        ],
      },
    ],
    [
      "a trend of shares: one-decimal percentages",
      config("trend", "share"),
      { kind: "series", series: shareSeries, coverage },
      {
        columns: timeColumns,
        rows: [
          ["2026-09-01 09:05", "100.0%", ""],
          ["2026-09-01 15:30", "40.5%", "59.5%"],
          ["2026-09-03 08:00", "0.0%", "100.0%"],
        ],
      },
    ],
    [
      "a stacked chart: each scan's shares of that scan's total",
      config("stacked-share", "count"),
      { kind: "series", series: stackedSeries, coverage },
      {
        columns: timeColumns,
        rows: [
          ["2026-09-01 09:05", "100.0%", ""],
          ["2026-09-01 15:30", "75.0%", "25.0%"],
          ["2026-09-03 08:00", "25.0%", "75.0%"],
        ],
      },
    ],
    [
      "a table chart: its series over time",
      config("table", "count"),
      { kind: "table", points: countPoints, series: countSeries, coverage },
      {
        columns: timeColumns,
        rows: [
          ["2026-09-01 09:05", "40", ""],
          ["2026-09-01 15:30", "45", "5"],
          ["2026-09-03 08:00", "50", "1250"],
        ],
      },
    ],
    [
      "bars of counts: largest first, as the chart draws them",
      config("bars", "count"),
      { kind: "snapshot", points: countPoints },
      { columns: ["Series", "Uses"], rows: [["Button · @example/ui", "1250"], ["@example/web", "50"]] },
    ],
    [
      "bars of shares",
      config("bars", "share"),
      { kind: "snapshot", points: sharePoints },
      { columns: ["Series", "Share"], rows: [["Button · @example/ui", "75.0%"], ["@example/web", "25.0%"]] },
    ],
  ];

  it.each(cases)("%s", (_, chartConfig, view, expected) => {
    expect(chartExportTable(chartConfig, view, "all")).toEqual(expected);
  });

  it("gives only the scans inside the range on screen", () => {
    const series: CohortSeries[] = [
      { ...web, points: [{ t: "2026-04-01T00:00:00Z", value: 30 }, { t: "2026-07-01T00:00:00Z", value: 40 }, { t: "2026-09-30T12:00:00Z", value: 50 }] },
    ];
    expect(chartExportTable(config("trend", "count"), { kind: "series", series, coverage }, "3m").rows).toEqual([
      ["2026-07-01 00:00", "40"],
      ["2026-09-30 12:00", "50"],
    ]);
  });

  it("names a deprecated-only series as the chart does, and only that series", () => {
    const kitConfig: DashboardConfig = {
      scope: { kind: "all" },
      cohorts: [{ kind: "tag", tagId: "t-vue", deprecatedOnly: true }, { kind: "package", packageName: "element-plus" }],
      chartType: "bars",
      metric: "count",
    };
    const view: DashboardView = {
      kind: "snapshot",
      points: [
        { cohortKey: "tag:t-vue", label: "vue-ui-kits", color: "", value: 51, componentCount: 11, role: "deprecated" },
        { cohortKey: "package:element-plus", label: "element-plus", color: "", value: 32, componentCount: 20 },
      ],
    };
    expect(chartExportTable(kitConfig, view, "all").rows).toEqual([
      ["vue-ui-kits · deprecated only", "51"],
      ["element-plus", "32"],
    ]);
  });
});

describe("toCsv", () => {
  const cases: Array<[string, string, string]> = [
    ["a plain field as it is", "Button", "Button"],
    ["a field with a comma in quotes", "Button, large", '"Button, large"'],
    ["a field with a quote in quotes, the quote doubled", 'Say "hi"', '"Say ""hi"""'],
    ["a field with a line break in quotes", "two\nlines", '"two\nlines"'],
    ["a field that starts with = behind a quote mark, so it can't run as a formula", "=SUM(A1)", "'=SUM(A1)"],
    ["a field that starts with + behind a quote mark", "+SUM(A1)", "'+SUM(A1)"],
    ["a field that starts with - behind a quote mark", "-SUM(A1)", "'-SUM(A1)"],
    ["a field that starts with a tab behind a quote mark", "\tSUM(A1)", "'\tSUM(A1)"],
    ["a field that starts with a carriage return behind a quote mark, in quotes", "\rSUM(A1)", '"\'\rSUM(A1)"'],
    ["a field that starts with @ behind a quote mark", "@SUM(A1)", "'@SUM(A1)"],
    ["a scoped package name as it is", "@example/web-button", "@example/web-button"],
    ["a number as it is", "125", "125"],
  ];

  it.each(cases)("writes %s", (_, field, written) => {
    expect(toCsv({ columns: ["Series", "Uses"], rows: [[field, "1"]] })).toBe(`Series,Uses\r\n${written},1`);
  });
});

describe("toTsv", () => {
  const cases: Array<[string, string, string]> = [
    ["a plain field as it is", "Button", "Button"],
    ["a tab as a space", "a\tb", "a b"],
    ["a line break as a space", "a\nb", "a b"],
    ["a CRLF line break as one space", "a\r\nb", "a b"],
    ["a field that starts with = behind a quote mark", "=SUM(A1)", "'=SUM(A1)"],
  ];

  it.each(cases)("writes %s", (_, field, written) => {
    expect(toTsv({ columns: ["Series", "Uses"], rows: [[field, "1"]] })).toBe(`Series\tUses\n${written}\t1`);
  });
});

describe("exportFileName", () => {
  const cases: Array<[string, string, string, string]> = [
    ["keeps a plain title", "Button adoption", "png", "Button adoption.png"],
    ["drops a colon", "Migration: Old → New", "csv", "Migration Old → New.csv"],
    ["drops each other character a file name can't hold", 'b:c*d?e"f<g>h|i', "png", "bcdefghi.png"],
    ["turns a slash into a space, keeping a package's scope apart from its name", "Migration: Button · @sample/core", "png", "Migration Button · @sample core.png"],
    ["turns a backslash into a space", "web\\native", "csv", "web native.csv"],
    ["collapses the double space a slash leaves", "web / native", "png", "web native.png"],
    ["trims the ends", " / Button / ", "csv", "Button.csv"],
  ];

  it.each(cases)("%s", (_, title, ext, name) => {
    expect(exportFileName(title, ext)).toBe(name);
  });
});
