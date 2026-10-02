import { describe, it, expect } from "vitest";
import type { CohortSeries } from "@scoutui/web-shared";
import { seriesToRows, cohortChartConfig, dashSwatchSegments, dayTicks, expandRowShares, cohortColor, seriesDashes, seriesWashes, tooltipRowTimestamp } from "@/lib/dashboard-chart-data";
import { CHART_SERIES_PALETTE, paletteToken } from "@/lib/chart-palette";

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

describe("cohortColor", () => {
  it("role wins over everything: deprecated → red token, successor → teal token", () => {
    expect(cohortColor({ cohortKey: "component:c1", color: "#7c3aed", role: "deprecated" }, 0)).toBe("var(--viz-deprecated)");
    expect(cohortColor({ cohortKey: "package:@x/next", color: "#7c3aed", role: "successor" }, 0)).toBe("var(--viz-primary)");
  });
  it("authored palette hexes resolve to their theme token; custom hexes stay verbatim", () => {
    expect(cohortColor({ cohortKey: "tag:icons", color: "#009598" }, 0)).toBe("var(--viz-primary)");
    expect(cohortColor({ cohortKey: "tag:primitives", color: "#9b6bce" }, 0)).toBe("var(--viz-cat-2)");
    expect(cohortColor({ cohortKey: "tag:web", color: "#7c3aed" }, 0)).toBe("#7c3aed");
  });
  it("gives the local cohort the semantic legacy grey", () => {
    expect(cohortColor({ cohortKey: "local", color: "" }, 2)).toBe("var(--viz-legacy)");
  });
  it("rotates the identity hues for uncoloured cohorts, never the grey slot", () => {
    expect(cohortColor({ cohortKey: "package:@x/y", color: "" }, 0)).toBe(CHART_SERIES_PALETTE[0]);
    expect(cohortColor({ cohortKey: "package:@a/b", color: "" }, 2)).toBe(CHART_SERIES_PALETTE[2]);
    expect(cohortColor({ cohortKey: "package:@c/d", color: "" }, 3)).toBe(CHART_SERIES_PALETTE[0]);
    expect(cohortColor({ cohortKey: "package:@e/f", color: "" }, 4)).toBe(CHART_SERIES_PALETTE[1]);
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

describe("seriesDashes", () => {
  const dep = (cohortKey: string) => ({ cohortKey, color: "", role: "deprecated" as const });

  it("dashes the second and third series sharing a role colour", () => {
    expect(seriesDashes([dep("a"), dep("b"), dep("c")])).toEqual([undefined, "5 4", "2 3"]);
  });

  it("keeps colour-distinct series solid", () => {
    expect(
      seriesDashes([
        { cohortKey: "a", color: "" },
        { cohortKey: "b", color: "" },
        { cohortKey: "c", color: "" },
      ]),
    ).toEqual([undefined, undefined, undefined]);
  });

  it("dashes the palette wrap: the 4th uncoloured series repeats the 3-hue rotation", () => {
    const s = ["a", "b", "c", "d"].map((cohortKey) => ({ cohortKey, color: "" }));
    expect(seriesDashes(s)).toEqual([undefined, undefined, undefined, "5 4"]);
  });

  it("mixes roles and rotation independently", () => {
    expect(seriesDashes([dep("a"), { cohortKey: "b", color: "" }, dep("c")])).toEqual([
      undefined,
      undefined,
      "5 4",
    ]);
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

describe("dashSwatchSegments", () => {
  it("scales each DASH_STEPS pattern down to a segment array distinct from the others", () => {
    const solid = dashSwatchSegments("");
    const step1 = dashSwatchSegments("5 4");
    const step2 = dashSwatchSegments("2 3");
    const step3 = dashSwatchSegments("8 3 2 3");
    expect(solid).toEqual([]);
    expect(step1).toEqual([3, 2]);
    expect(step2).toEqual([1, 2]);
    expect(step3).toEqual([4, 2, 1, 2]);
    // Every non-solid step tiles at a different total length, so the swatch's
    // repeating rhythm is visibly distinct step to step.
    const totals = [step1, step2, step3].map((s) => s.reduce((a, b) => a + b, 0));
    expect(new Set(totals).size).toBe(totals.length);
  });

  it("keeps every segment at least 1px, even for a sub-2 pattern value", () => {
    expect(dashSwatchSegments("1 1")).toEqual([1, 1]);
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
