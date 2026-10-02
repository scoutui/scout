import { describe, it, expect } from "vitest";
import type { CohortRole, CohortSelector, CohortSeries } from "@scoutui/web-shared";
import { seriesToRows, cohortChartConfig, dayTicks, expandRowShares, chartColors, savedChartCohorts, seriesWashes, tooltipRowTimestamp, type ChartCohort } from "@/lib/dashboard-chart-data";
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
  it("maps each of the four palette hexes to its theme token", () => {
    expect(paletteToken("#009598")).toBe("var(--viz-primary)");
    expect(paletteToken("#9b6bce")).toBe("var(--viz-cat-2)");
    expect(paletteToken("#2863ab")).toBe("var(--viz-cat-3)");
    expect(paletteToken("#7d8088")).toBe("var(--viz-legacy)");
  });
  it("returns non-palette hexes verbatim (authored-value doctrine for custom colours)", () => {
    expect(paletteToken("#7c3aed")).toBe("#7c3aed");
    expect(paletteToken("")).toBe("");
  });
});

describe("chartColors", () => {
  const tag = (id: string, color: string) => ({ cohortKey: `tag:${id}`, color });
  const pkg = (name: string, role?: CohortRole) => ({ cohortKey: `package:${name}`, color: "", role });
  const comp = (id: string) => ({ cohortKey: `component:${id}`, color: "" });
  const local = { cohortKey: "local", color: "" };

  const cases: Array<[string, ChartCohort[], Record<string, string>]> = [
    ["a tag keeps its colour", [tag("a", "#009598")], { "tag:a": "var(--viz-primary)" }],
    [
      "a second tag with the same colour takes the next free chart colour",
      [tag("a", "#009598"), tag("b", "#009598")],
      { "tag:a": "var(--viz-primary)", "tag:b": "var(--viz-cat-2)" },
    ],
    [
      "a tag whose colour looks like an earlier line's loses it",
      [local, tag("a", "#7d8088")],
      { local: "var(--viz-local)", "tag:a": "var(--viz-primary)" },
    ],
    [
      "a teal tag saved before a successor line takes violet",
      [tag("a", "#009598"), pkg("x", "successor")],
      { "tag:a": "var(--viz-cat-2)", "package:x": "var(--viz-primary)" },
    ],
    [
      "a package never takes a colour a tag holds, whatever its position",
      [pkg("x"), tag("a", "#009598")],
      { "package:x": "var(--viz-cat-2)", "tag:a": "var(--viz-primary)" },
    ],
    [
      "packages and components get theme tokens, and the fourth uncoloured line repeats teal",
      [pkg("a"), pkg("b"), comp("c"), pkg("d")],
      {
        "package:a": "var(--viz-primary)",
        "package:b": "var(--viz-cat-2)",
        "component:c": "var(--viz-cat-3)",
        "package:d": "var(--viz-primary)",
      },
    ],
    ["a custom tag colour stays as written", [tag("a", "#7c3aed")], { "tag:a": "#7c3aed" }],
    [
      "deprecated is orange and Local is the Local grey",
      [{ ...tag("a", "#009598"), role: "deprecated" }, local],
      { "tag:a": "var(--viz-deprecated)", local: "var(--viz-local)" },
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
    const expected = ["var(--viz-deprecated)", "var(--viz-cat-2)", "#7c3aed"];
    expect(colorsOf([pkg("x", "deprecated"), comp("c"), pkg("y"), tag("t", "#7c3aed")])).toEqual(expected);
    expect(colorsOf([pkg("x", "deprecated"), pkg("y"), tag("t", "#7c3aed")])).toEqual(expected);
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
