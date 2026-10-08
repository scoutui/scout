import { describe, it, expect } from "vitest";
import type { ChartRange, CohortRole, CohortSelector, CohortSeries, DashboardConfig, DashboardView } from "@scoutui/web-shared";
import { seriesToRows, cohortChartConfig, dayTicks, expandRowShares, chartColors, chartRange, lineJoins, repoCoverageAt, reposJoiningAt, savedChartCohorts, scanDetail, seriesFrom, seriesWashes, tooltipListScroll, tooltipRowTimestamp, tooltipRows, visibleView, type ChartCohort } from "@/lib/dashboard-chart-data";
import { looksAlike, paletteToken } from "@/lib/chart-palette";

const series: CohortSeries[] = [
  { cohortKey: "tag:web", label: "web", color: "#7c3aed", points: [{ t: "2026-01-01", value: 4 }, { t: "2026-01-02", value: 10 }] },
  { cohortKey: "tag:legacy", label: "legacy", color: "#dc2626", points: [{ t: "2026-01-01", value: 1 }, { t: "2026-01-02", value: 3 }] },
];

describe("seriesToRows", () => {
  it("pivots series into one row per timestamp keyed by cohortKey", () => {
    expect(seriesToRows(series)).toEqual([
      { t: "2026-01-01", ts: Date.parse("2026-01-01"), "tag:web": 4, "tag:legacy": 1 },
      { t: "2026-01-02", ts: Date.parse("2026-01-02"), "tag:web": 10, "tag:legacy": 3 },
    ]);
  });
});

describe("cohortChartConfig", () => {
  it("maps each cohort to a label only", () => {
    const cfg = cohortChartConfig([{ cohortKey: "tag:web", label: "web" }, { cohortKey: "local", label: "local" }]);
    expect(cfg["tag:web"]).toEqual({ label: "web" });
    // biome-ignore lint/complexity/useLiteralKeys: index-signature access requires bracket notation (noPropertyAccessFromIndexSignature)
    expect(cfg["local"]).toEqual({ label: "local" });
  });
});

describe("paletteToken", () => {
  it("maps each tag colour to its theme token", () => {
    expect(paletteToken("teal")).toBe("var(--viz-primary)");
    expect(paletteToken("violet")).toBe("var(--viz-cat-2)");
    expect(paletteToken("blue")).toBe("var(--viz-cat-3)");
    expect(paletteToken("berry")).toBe("var(--viz-cat-4)");
    expect(paletteToken("orchid")).toBe("var(--viz-cat-5)");
  });
  it("returns nothing for a colour that isn't a tag colour", () => {
    expect(paletteToken("#009598")).toBeUndefined();
    expect(paletteToken("grey")).toBeUndefined();
    expect(paletteToken("")).toBeUndefined();
  });
});

describe("chartColors", () => {
  const tag = (id: string, color: string) => ({ cohortKey: `tag:${id}`, color });
  const pkg = (name: string, role?: CohortRole) => ({ cohortKey: `package:${name}`, color: "", role });
  const comp = (id: string) => ({ cohortKey: `component:${id}`, color: "" });
  const local = { cohortKey: "local", color: "" };

  const cases: Array<[string, ChartCohort[], Record<string, string>]> = [
    ["a tag keeps its colour", [tag("a", "orchid")], { "tag:a": "var(--viz-cat-5)" }],
    [
      "a second tag with the same colour takes the next free chart colour",
      [tag("a", "teal"), tag("b", "teal")],
      { "tag:a": "var(--viz-primary)", "tag:b": "var(--viz-cat-2)" },
    ],
    [
      "a teal tag saved before a successor line takes violet",
      [tag("a", "teal"), pkg("x", "successor")],
      { "tag:a": "var(--viz-cat-2)", "package:x": "var(--viz-primary)" },
    ],
    [
      "a package never takes a colour a tag holds, whatever its position",
      [pkg("x"), tag("a", "teal")],
      { "package:x": "var(--viz-cat-2)", "tag:a": "var(--viz-primary)" },
    ],
    [
      "packages and components get theme tokens, and the sixth uncoloured line repeats teal",
      [pkg("a"), pkg("b"), comp("c"), pkg("d"), pkg("e"), pkg("f")],
      {
        "package:a": "var(--viz-primary)",
        "package:b": "var(--viz-cat-2)",
        "component:c": "var(--viz-cat-3)",
        "package:d": "var(--viz-cat-4)",
        "package:e": "var(--viz-cat-5)",
        "package:f": "var(--viz-primary)",
      },
    ],
    ["a colour that isn't a tag colour takes the first free chart colour", [tag("a", "#9b6bce")], { "tag:a": "var(--viz-primary)" }],
    [
      "deprecated is orange and Local is the Local grey",
      [{ ...tag("a", "teal"), role: "deprecated" }, local],
      { "tag:a": "var(--viz-deprecated)", local: "var(--viz-local)" },
    ],
    [
      "several deprecated lines all draw the deprecated orange, beside the successor's teal",
      [pkg("a", "deprecated"), pkg("b", "deprecated"), pkg("c", "successor")],
      { "package:a": "var(--viz-deprecated)", "package:b": "var(--viz-deprecated)", "package:c": "var(--viz-primary)" },
    ],
  ];

  it.each(cases)("%s", (_title, cohorts, expected) => {
    expect(Object.fromEntries(chartColors(cohorts))).toEqual(expected);
  });

  it("gives every line of a nine-package chart a colour, and no two neighbours look alike", () => {
    const cohorts = Array.from({ length: 9 }, (_, i) => pkg(`p${i}`));
    const colors = chartColors(cohorts);
    const drawn = cohorts.map((c) => colors.get(c.cohortKey) ?? "none");
    expect(drawn).not.toContain("none");
    expect(drawn.slice(1).map((color, i) => looksAlike(drawn[i] ?? "", color))).not.toContain(true);
  });

  it("keeps the turn of a saved cohort the view doesn't draw, and the colour and role of each one it does", () => {
    const saved: CohortSelector[] = [
      { kind: "package", packageName: "x" },
      { kind: "component", componentId: "c" },
      { kind: "package", packageName: "y" },
      { kind: "tag", tagId: "t" },
    ];
    const colorsOf = (drawn: ChartCohort[]) => {
      const colors = chartColors(savedChartCohorts(saved, drawn));
      return [colors.get("package:x"), colors.get("package:y"), colors.get("tag:t")];
    };
    const expected = ["var(--viz-deprecated)", "var(--viz-cat-2)", "var(--viz-cat-5)"];
    expect(colorsOf([pkg("x", "deprecated"), comp("c"), pkg("y"), tag("t", "orchid")])).toEqual(expected);
    expect(colorsOf([pkg("x", "deprecated"), pkg("y"), tag("t", "orchid")])).toEqual(expected);
  });

  it("colours a drawn cohort that no saved selector names", () => {
    const saved: CohortSelector[] = [
      { kind: "component", componentId: "a" },
      { kind: "package", packageName: "x", role: "successor" },
    ];
    const drawn: ChartCohort[] = [
      { cohortKey: "deprecated:r", color: "", role: "deprecated" },
      { cohortKey: "successor:r", color: "", role: "successor" },
    ];
    const colors = chartColors(savedChartCohorts(saved, drawn));
    expect([colors.get("deprecated:r"), colors.get("successor:r")]).toEqual(["var(--viz-deprecated)", "var(--viz-primary)"]);
  });
});

describe("seriesWashes", () => {
  const dep = { cohortKey: "a", color: "", role: "deprecated" as const };
  const succ = { cohortKey: "b", color: "", role: "successor" as const };

  it("a lone series always washes: a retirement's whole shape is its debt", () => {
    expect(seriesWashes([dep])).toEqual([true]);
  });

  it("paired with its successor, the deprecated series is line-only and the successor washes", () => {
    expect(seriesWashes([dep, succ])).toEqual([false, true]);
  });

  it("role-less comparisons all wash (library trends)", () => {
    expect(seriesWashes([{ cohortKey: "a", color: "" }, { cohortKey: "b", color: "" }])).toEqual([true, true]);
  });

  it("three role-less series still wash: the cap starts at four", () => {
    const three = ["a", "b", "c"].map((cohortKey) => ({ cohortKey, color: "" }));
    expect(seriesWashes(three)).toEqual([true, true, true]);
  });

  it("the wash cap: at four series nobody washes", () => {
    const four = ["a", "b", "c", "d"].map((cohortKey) => ({ cohortKey, color: "" }));
    expect(seriesWashes(four)).toEqual([false, false, false, false]);
  });
});

describe("time axis", () => {
  it("seriesToRows stamps each row with epoch ms", () => {
    const rows = seriesToRows([
      { cohortKey: "a", label: "a", color: "", points: [{ t: "2026-07-13T09:00:00.000Z", value: 1 }] },
    ]);
    // biome-ignore lint/complexity/useLiteralKeys: index-signature access requires bracket notation (noPropertyAccessFromIndexSignature)
    expect(rows[0]?.["ts"]).toBe(Date.parse("2026-07-13T09:00:00.000Z"));
  });

  it("dayTicks returns the first scan of each day as epoch ms", () => {
    const rows = seriesToRows([
      {
        cohortKey: "a",
        label: "a",
        color: "",
        points: [
          { t: "2026-07-13T09:00:00.000Z", value: 1 },
          { t: "2026-07-13T18:00:00.000Z", value: 2 },
          { t: "2026-07-15T07:00:00.000Z", value: 3 },
        ],
      },
    ]);
    expect(dayTicks(rows)).toEqual([
      Date.parse("2026-07-13T09:00:00.000Z"),
      Date.parse("2026-07-15T07:00:00.000Z"),
    ]);
  });
});

describe("tooltipRows", () => {
  const row = (name: string, value: number | undefined) => ({ name, value });
  const names = (rows: { name: string }[]) => rows.map((r) => r.name);

  it("lists every series, largest value first, however many there are", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => row(`s${i}`, i * 10));
    expect(names(tooltipRows(eleven, 0).rows)).toEqual(["s10", "s9", "s8", "s7", "s6", "s5", "s4", "s3", "s2", "s1", "s0"]);
  });

  it("puts a series with no value at that scan after those with one", () => {
    expect(names(tooltipRows([row("a", undefined), row("b", 0)], 0).rows)).toEqual(["b", "a"]);
  });

  const lines = [row("a", 0), row("b", 0), row("c", 40), row("d", 50)];

  it.each([
    ["on a line", 40, "c"],
    ["between two lines, nearer the lower", 43, "c"],
    ["between two lines, nearer the upper", 47, "d"],
    ["above every line", 500, "d"],
    ["on lines that share a value, the one drawn last", 0, "b"],
  ])("marks the line under the pointer: %s", (_, at, name) => {
    expect(tooltipRows(lines, at).under?.name).toBe(name);
  });

  it.each([
    ["without a pointer", lines, undefined],
    ["with a single line", [row("a", 40)], 40],
  ])("marks no line %s", (_, payload, at) => {
    expect(tooltipRows(payload, at).under).toBeUndefined();
  });

  it.each([
    ["in the bottom band", 0.05, "s1"],
    ["in a band stacked above it", 0.15, "s0"],
    ["above the stack", 1.2, "s10"],
  ])("marks the band under the pointer, stacked in series order: %s", (_, at, name) => {
    const bands = Array.from({ length: 11 }, (_, i) => ({ name: `s${i}`, dataKey: `s${i}`, value: i === 1 ? 0.1 : 0.09 }));
    const order = ["s1", "s0", ...bands.slice(2).map((b) => b.dataKey)];
    expect(tooltipRows(bands, at, order).under?.name).toBe(name);
  });
});

describe("tooltipRowTimestamp", () => {
  it("reads ts off the hovered payload row, not the formatted label", () => {
    const payload = [{ payload: { t: "2026-07-13T09:00:00.000Z", ts: Date.parse("2026-07-13T09:00:00.000Z"), web: 4 } }];
    expect(tooltipRowTimestamp(payload)).toBe(Date.parse("2026-07-13T09:00:00.000Z"));
  });

  it("returns null instead of NaN when the row has no numeric ts (regression: shadcn hands labelFormatter a cohort display label, e.g. \"web\", not the axis value, once the x-axis is numeric)", () => {
    const payload = [{ payload: { t: "2026-07-13T09:00:00.000Z", web: 4 } }];
    expect(tooltipRowTimestamp(payload)).toBeNull();
  });

  it("returns null for an empty or missing payload", () => {
    expect(tooltipRowTimestamp([])).toBeNull();
    expect(tooltipRowTimestamp(undefined)).toBeNull();
  });
});

describe("repoCoverageAt", () => {
  const estate = { total: 4, repoIds: ["checkout", "storefront", "account", "admin"], points: [{ t: "2026-06-01T00:00:00Z", repos: 3 }, { t: "2026-09-01T00:00:00Z", repos: 4 }] };
  const oneRepo = { total: 1, repoIds: ["checkout"], points: [{ t: "2026-06-01T00:00:00Z", repos: 1 }] };
  it.each([
    ["a point some of the repos have reached", estate, "2026-06-01T00:00:00Z", "3 of 4 repos"],
    ["a point every repo has reached", estate, "2026-09-01T00:00:00Z", "4 of 4 repos"],
    ["a chart of one repo", oneRepo, "2026-06-01T00:00:00Z", null],
  ])("labels %s", (_, coverage, t, label) => {
    expect(repoCoverageAt(coverage, Date.parse(t))).toBe(label);
  });
});

describe("tooltipListScroll", () => {
  const list = { height: 188, content: 1076, pitch: 18, scrollbar: 0 };

  it.each([
    ["stays put while the row and its neighbours are in view", 0, 36, 0],
    ["scrolls down to show the row and the one below, landing on a row", 0, 500, 360],
    ["scrolls up to show the row and the one above", 360, 90, 72],
    ["stops at the end of the list", 0, 1058, 888],
    ["stays where it was scrolled without a row under the pointer", 365, undefined, 365],
  ])("%s", (_, scrollTop, rowTop, top) => {
    expect(tooltipListScroll({ ...list, scrollTop, rowTop }).scrollTop).toBe(top);
  });

  it.each([
    ["at the top, rows below only", 0, { above: false, below: true }],
    ["scrolled part way, rows both ways", 360, { above: true, below: true }],
    ["at the end, rows above only", 888, { above: true, below: false }],
  ])("says which edges have rows beyond them: %s", (_, scrollTop, edges) => {
    expect(tooltipListScroll({ ...list, scrollTop })).toMatchObject(edges);
  });

  it("says a list that fits has no rows beyond either edge", () => {
    expect(tooltipListScroll({ ...list, content: 120, scrollTop: 0 })).toMatchObject({ above: false, below: false });
  });

  it.each([
    ["a list that scrolls under a scrollbar drawn over its rows", true, 1076, 0],
    ["a list that scrolls beside a scrollbar that takes its own width", false, 1076, 15],
    ["a list that fits", false, 120, 0],
  ])("says whether %s needs room at its end for the scrollbar: %s", (_, room, content, scrollbar) => {
    expect(tooltipListScroll({ ...list, content, scrollbar, scrollTop: 0 }).scrollbarRoom).toBe(room);
  });
});

describe("repos joining a line", () => {
  const [t1, t2, t3] = ["2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z"];
  const line = (key: string, points: Array<{ t: string; value: number; added?: string[] }>) => ({ cohortKey: key, label: key, color: "", points });
  const series = [
    line("a", [{ t: t1, value: 1, added: ["storefront"] }, { t: t2, value: 4, added: ["checkout"] }, { t: t3, value: 6, added: ["admin", "help", "search"] }]),
    line("b", [{ t: t2, value: 2, added: ["checkout"] }, { t: t3, value: 3, added: ["admin"] }]),
  ];

  it("marks each point where a repo joins a line after its first point", () => {
    expect(lineJoins(series)).toEqual(new Map([["a", new Set([t2, t3])], ["b", new Set([t3])]]));
  });

  it.each([
    ["the line's first point only", t1, null],
    ["one repo", t2, "checkout added"],
    ["three or more repos", t3, "3 repos added"],
  ])("names the repos joining at %s", (_, t, text) => {
    expect(reposJoiningAt(series, Date.parse(t))).toBe(text);
  });

  it("names two repos joining at once", () => {
    expect(reposJoiningAt([line("a", [{ t: t1, value: 1 }, { t: t2, value: 4, added: ["checkout", "storefront"] }])], Date.parse(t2)))
      .toBe("checkout and storefront added");
  });

  const coverage = { total: 3, repoIds: ["account", "checkout", "storefront"], points: [{ t: t1, repos: 1 }, { t: t2, repos: 2 }, { t: t3, repos: 3 }] };
  const bands = [
    line("a", [{ t: t1, value: 0.6, added: ["storefront"] }, { t: t2, value: 0.5, added: ["checkout"] }, { t: t3, value: 0.5 }]),
    line("b", [{ t: t1, value: 0.4, added: ["storefront"] }, { t: t2, value: 0.5 }, { t: t3, value: 0.5 }]),
  ];

  it.each([
    ["the repos it covers and those joining its bands there", t2, "2 of 3 repos · checkout added"],
    ["only the repos it covers where none join", t3, "3 of 3 repos"],
  ])("describes a stacked chart's scan by %s", (_, t, text) => {
    expect(scanDetail(coverage, bands, Date.parse(t))).toBe(text);
  });
});

describe("expandRowShares", () => {
  it("renormalizes each row's cohort values to a fraction of that row's own total", () => {
    const rows = [
      { t: "2026-01-01", ts: 1, "tag:web": 4, "tag:legacy": 1 },
      { t: "2026-01-02", ts: 2, "tag:web": 10, "tag:legacy": 3 },
    ];
    expect(expandRowShares(rows, ["tag:web", "tag:legacy"])).toEqual([
      { t: "2026-01-01", ts: 1, "tag:web": 0.8, "tag:legacy": 0.2 },
      { t: "2026-01-02", ts: 2, "tag:web": 10 / 13, "tag:legacy": 3 / 13 },
    ]);
  });

  it("still fills exactly 100% when overlapping cohorts double-count (raw total > actual)", () => {
    const rows = [{ t: "2026-01-01", ts: 1, a: 6, b: 6 }];
    const [row] = expandRowShares(rows, ["a", "b"]);
    // biome-ignore lint/complexity/useLiteralKeys: index-signature access requires bracket notation (noPropertyAccessFromIndexSignature)
    expect(Number(row?.["a"]) + Number(row?.["b"])).toBe(1);
  });

  it("guards divide-by-zero: an all-zero row stays zero, never NaN", () => {
    const rows = [{ t: "2026-01-01", ts: 1, a: 0, b: 0 }];
    expect(expandRowShares(rows, ["a", "b"])).toEqual([{ t: "2026-01-01", ts: 1, a: 0, b: 0 }]);
  });
});

describe("date range", () => {
  const line = (key: string, ts: string[]) => ({ cohortKey: key, label: key, color: "", points: ts.map((t, i) => ({ t, value: i + 1 })) });
  const series = [
    line("a", ["2025-01-15T00:00:00Z", "2026-03-10T00:00:00Z", "2026-07-01T00:00:00Z", "2026-09-30T12:00:00Z"]),
    line("b", ["2026-08-20T00:00:00Z", "2026-09-30T12:00:00Z"]),
  ];

  it("starts each line at the start with its value then, and a line that starts later where it starts", () => {
    const from = Date.parse("2026-06-30T12:00:00Z");
    expect(seriesFrom(series, from).map((s) => s.points)).toEqual([
      [{ t: "2026-06-30T12:00:00.000Z", value: 2 }, { t: "2026-07-01T00:00:00Z", value: 3 }, { t: "2026-09-30T12:00:00Z", value: 4 }],
      [{ t: "2026-08-20T00:00:00Z", value: 1 }, { t: "2026-09-30T12:00:00Z", value: 2 }],
    ]);
  });

  it("keeps a point that falls on the start, and nothing before it", () => {
    const from = Date.parse("2026-07-01T00:00:00Z");
    expect(seriesFrom(series, from)[0]?.points.map((p) => p.t)).toEqual(["2026-07-01T00:00:00Z", "2026-09-30T12:00:00Z"]);
  });

  const coverage = { total: 1, repoIds: ["checkout"], points: [] };
  const shown = (chartType: DashboardConfig["chartType"], view: DashboardView, range: ChartRange) =>
    visibleView({ scope: { kind: "all" }, cohorts: [], chartType, metric: "count" }, view, range);

  it.each(["trend", "stacked-share"] as const)("draws a %s chart from the range's start, and whole at All", (chartType) => {
    const view: DashboardView = { kind: "series", series, coverage };
    const from = Date.parse("2026-06-30T12:00:00Z");
    expect(shown(chartType, view, "3m")).toEqual({ view: { ...view, series: seriesFrom(series, from) }, from });
    expect(shown(chartType, view, "all")).toEqual({ view, from: null });
  });

  it("draws a table chart whole at any range", () => {
    const view: DashboardView = { kind: "table", points: [], series, coverage, change: {} };
    expect(shown("table", view, "3m")).toEqual({ view, from: null });
  });

  it.each([
    ["3m", "3m"],
    ["6m", "6m"],
    ["1y", "1y"],
    ["all", "all"],
    ["2y", null],
    [["6m", "3m"], "6m"],
    [undefined, null],
  ] as const)("reads %j from a link as %j", (raw, range) => {
    expect(chartRange(raw)).toBe(range);
  });
});
