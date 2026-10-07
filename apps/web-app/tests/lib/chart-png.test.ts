// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CohortPoint, CohortSelector, CohortSeries, DashboardConfig, DashboardView } from "@scoutui/web-shared";
import { TAG_COLOURS } from "@scoutui/web-shared/client";
import { chartFigure, type ChartFigure } from "@/lib/chart-figure";
import { chartPng, type FigureContext, lightChartColors, paintFigure } from "@/lib/chart-png";
import { type ChartCohort, chartColors } from "@/lib/dashboard-chart-data";
import { figureTexts } from "../helpers/figure-texts";

const MORNING = "2026-09-01T09:05:00Z";
const LATER = "2026-09-03T08:00:00Z";

const web = { cohortKey: "package:@example/web", label: "@example/web", color: "" };
const button = { cohortKey: "component:btn", label: "Button · @example/ui", color: "" };
const cohorts: CohortSelector[] = [
  { kind: "package", packageName: "@example/web" },
  { kind: "component", componentId: "btn" },
];
const coverage = { total: 2, points: [MORNING, LATER].map((t) => ({ t, repos: 2 })) };
const countSeries: CohortSeries[] = [
  { ...web, points: [{ t: MORNING, value: 40 }, { t: LATER, value: 50 }] },
  { ...button, points: [{ t: MORNING, value: 5 }, { t: LATER, value: 125 }] },
];
const shareSeries: CohortSeries[] = [
  { ...web, points: [{ t: MORNING, value: 0.6 }, { t: LATER, value: 0.2 }] },
  { ...button, points: [{ t: MORNING, value: 0.1 }, { t: LATER, value: 0.6 }] },
];
const points: CohortPoint[] = [
  { ...web, value: 50, componentCount: 3 },
  { ...button, value: 125, componentCount: 1 },
];

const colors: Record<string, string> = {
  "var(--viz-primary)": "#008080",
  "var(--viz-cat-2)": "#7a3fd1",
  "var(--viz-cat-3)": "#1f5fa8",
  "var(--viz-cat-4)": "#b0306a",
  "var(--viz-cat-5)": "#c45bd6",
  "var(--viz-local)": "#b5b8bd",
  background: "#ffffff",
  ink: "#1c1d20",
  muted: "#5d6067",
  grid: "#e2e3e6",
};
const FONTS = { sans: '"Sans Test", sans-serif', mono: '"Mono Test", monospace' };

const config = (chartType: DashboardConfig["chartType"]): DashboardConfig => ({ scope: { kind: "all" }, cohorts, chartType, metric: "count" });

function drawn(chartConfig: DashboardConfig, view: DashboardView): ChartFigure {
  const figure = chartFigure({ title: "Button adoption", config: chartConfig, view, host: "scout.example.com", exportedAt: new Date(2026, 9, 4), colors, nameWidth: (name) => name.length * 9 });
  if (figure === null) throw new Error("expected a figure");
  return figure;
}

type Call = { op: string; args: unknown[]; font: string };

/** A 2D context that records what is drawn, measuring each character of text as `charWidth` wide. */
function recorder(charWidth: number): { ctx: FigureContext; calls: Call[] } {
  const calls: Call[] = [];
  const ctx: FigureContext = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "miter",
    lineCap: "butt",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    scale: (...args) => record("scale", args),
    fillRect: (...args) => record("fillRect", args),
    fillText: (...args) => record("fillText", args),
    measureText: (text) => ({ width: text.length * charWidth }) as TextMetrics,
    beginPath: (...args) => record("beginPath", args),
    moveTo: (...args) => record("moveTo", args),
    lineTo: (...args) => record("lineTo", args),
    closePath: (...args) => record("closePath", args),
    arc: (...args) => record("arc", args),
    fill: (...args: unknown[]) => record("fill", args),
    stroke: (...args: unknown[]) => record("stroke", args),
  };
  const record = (op: string, args: unknown[]) => calls.push({ op, args, font: ctx.font });
  return { ctx, calls };
}

const textsDrawn = (calls: Call[]) => calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]));

const many: CohortSeries[] = Array.from({ length: 12 }, (_, i) => ({
  cohortKey: `package:@example/p${i}`,
  label: `@example/p${i}`,
  color: "",
  points: [{ t: MORNING, value: 100 }, { t: LATER, value: i }],
}));
const manyConfig = (chartType: DashboardConfig["chartType"]): DashboardConfig => ({
  ...config(chartType),
  cohorts: many.map((s) => ({ kind: "package", packageName: s.label })),
});

describe("paintFigure", () => {
  const cases: Array<[string, DashboardConfig, DashboardView]> = [
    ["a trend", config("trend"), { kind: "series", series: countSeries, coverage }],
    ["a trend with more lines than it names", manyConfig("trend"), { kind: "series", series: many, coverage }],
    ["a stacked chart", config("stacked-share"), { kind: "series", series: shareSeries, coverage }],
    ["a stacked chart with more series than its legend lists", manyConfig("stacked-share"), { kind: "series", series: many, coverage }],
    ["bars", config("bars"), { kind: "snapshot", points }],
  ];

  it.each(cases)("draws %s at twice its size, with every text the figure holds and no other", (_, chartConfig, view) => {
    const figure = drawn(chartConfig, view);
    const { ctx, calls } = recorder(1);
    paintFigure(ctx, figure, FONTS);
    expect(calls.filter((c) => c.op === "scale").map((c) => c.args)).toEqual([[2, 2]]);
    expect(textsDrawn(calls).sort()).toEqual(figureTexts(figure).sort());
  });

  it("shortens text that would run past its width, ending it with …", () => {
    const figure = drawn(config("trend"), { kind: "series", series: countSeries, coverage });
    const { ctx, calls } = recorder(10);
    paintFigure(ctx, { ...figure, title: { ...figure.title, text: "Button adoption across every repo", maxWidth: 100 } }, FONTS);
    expect(textsDrawn(calls)).toContain("Button ad…");
  });
});

const addStyle = (css: string) => {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
};
const paletteCss = () => readFileSync(createRequire(import.meta.url).resolve("@scoutui/palette/palette.css"), "utf8");

describe("chartPng", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.head.innerHTML = "";
    document.documentElement.removeAttribute("style");
    Reflect.deleteProperty(document, "fonts");
  });

  it.each([
    ["the page's faces", { "--font-sans": '"Sans Test", sans-serif', "--font-mono": '"Mono Test", monospace' }, FONTS],
    ["the browser's sans and mono faces when the page names none", {}, { sans: "sans-serif", mono: "monospace" }],
  ])("sets its text in %s", async (_, properties: Record<string, string>, fonts) => {
    addStyle(paletteCss());
    for (const [name, value] of Object.entries(properties)) document.documentElement.style.setProperty(name, value);
    Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
    const { ctx, calls } = recorder(1);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => done(new Blob(["png"], { type: "image/png" })));
    const png = await chartPng({ title: "Button adoption", config: config("trend"), view: { kind: "series", series: countSeries, coverage }, host: "scout.example.com", exportedAt: new Date(2026, 9, 4) });
    expect(png.type).toBe("image/png");
    const fontOf = (text: string) => calls.find((c) => c.op === "fillText" && c.args[0] === text)?.font;
    expect(fontOf("Button adoption")).toBe(`600 30px ${fonts.sans}`);
    expect(fontOf("@example/web")).toBe(`400 15px ${fonts.mono}`);
  });

  it("draws each bar's whole name, however wide the page's mono face sets it", async () => {
    addStyle(paletteCss());
    Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
    const { ctx, calls } = recorder(10);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => done(new Blob(["png"], { type: "image/png" })));
    await chartPng({ title: "Button adoption", config: config("bars"), view: { kind: "snapshot", points }, host: "scout.example.com", exportedAt: new Date(2026, 9, 4) });
    expect(textsDrawn(calls)).toEqual(expect.arrayContaining(["@example/web", "Button · @example/ui"]));
  });
});

describe("lightChartColors", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    document.documentElement.className = "";
  });

  it("reads each colour's light value from the page's :root palette, past a sheet it can't read, even when the page is dark", () => {
    addStyle(`:root { --pal-teal-graphic: #0a7f8c; --pal-neutral-panel: #ffffff; }
.dark { --pal-teal-graphic: #5fd4dc; --pal-neutral-panel: #1c1d20; }`);
    document.documentElement.classList.add("dark");
    const unreadable = {
      get cssRules(): CSSRuleList {
        throw new DOMException("The sheet comes from another origin.", "SecurityError");
      },
    } as CSSStyleSheet;
    expect(lightChartColors([unreadable, ...document.styleSheets])).toMatchObject({
      "var(--viz-primary)": "#0a7f8c",
      background: "#ffffff",
    });
  });

  it("gives every colour a chart can draw with, and each figure colour role, a value from the palette", () => {
    addStyle(paletteCss());
    const every: ChartCohort[] = [
      { cohortKey: "deprecated", color: "", role: "deprecated" },
      { cohortKey: "successor", color: "", role: "successor" },
      { cohortKey: "local", color: "" },
      ...TAG_COLOURS.map((color) => ({ cohortKey: `tag:${color}`, color })),
      ...Array.from({ length: 7 }, (_, i) => ({ cohortKey: `package:@example/p${i}`, color: "" })),
    ];
    const resolved = lightChartColors();
    for (const key of [...new Set(chartColors(every).values()), "background", "ink", "muted", "grid"]) {
      expect(resolved[key], key).toMatch(/\S/);
    }
  });
});
