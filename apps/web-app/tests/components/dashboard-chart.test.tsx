// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CohortPoint, CohortSeries, DashboardConfig, DashboardView } from "@scoutui/web-shared";
import { DashboardChart, LinkedDashboardChart } from "@/components/dashboards/dashboard-chart";

const oldButton = { cohortKey: "component:old", label: "OldButton", color: "", role: "deprecated" as const };
const newButton = { cohortKey: "component:new", label: "NewButton", color: "" };
const points: CohortPoint[] = [
  { ...oldButton, value: 30, componentCount: 1 },
  { ...newButton, value: 70, componentCount: 1 },
];
const series: CohortSeries[] = [
  { ...oldButton, points: [{ t: "2026-09-01T00:00:00Z", value: 40 }, { t: "2026-09-02T00:00:00Z", value: 30 }] },
  { ...newButton, points: [{ t: "2026-09-01T00:00:00Z", value: 60 }, { t: "2026-09-02T00:00:00Z", value: 70 }] },
];

const coverage = { total: 1, repoIds: ["checkout"], points: [{ t: "2026-09-01T00:00:00Z", repos: 1 }, { t: "2026-09-02T00:00:00Z", repos: 1 }] };

const charts: Array<[DashboardConfig["chartType"], DashboardView]> = [
  ["trend", { kind: "series", series, coverage }],
  ["stacked-share", { kind: "series", series, coverage }],
  ["table", { kind: "table", points, series, coverage, change: {} }],
  ["bars", { kind: "snapshot", points }],
];

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 640, 320));
});

describe("DashboardChart deprecated series", () => {
  it.each(charts)("marks only the deprecated series in a %s chart", (chartType, view) => {
    const config: DashboardConfig = {
      scope: { kind: "all" },
      cohorts: [{ kind: "component", componentId: "old" }, { kind: "component", componentId: "new" }],
      chartType,
      metric: "count",
    };
    const { container } = render(<DashboardChart config={config} view={view} />);
    const triangles = container.querySelectorAll("svg.lucide-triangle-alert");
    expect(triangles).toHaveLength(1);
    expect(screen.getAllByText("deprecated")).toHaveLength(1);
    let labelled = triangles[0]?.parentElement;
    while (labelled && !labelled.textContent?.includes("Button")) labelled = labelled.parentElement;
    expect(labelled?.textContent).toContain("OldButton");
    expect(labelled?.textContent).not.toContain("NewButton");
  });
});

const kits = { cohortKey: "tag:t-vue", label: "vue-ui-kits", color: "", role: "deprecated" as const };
const plus = { cohortKey: "package:element-plus", label: "element-plus", color: "" };
const kitPoints: CohortPoint[] = [{ ...kits, value: 51, componentCount: 11 }, { ...plus, value: 32, componentCount: 20 }];
const kitSeries: CohortSeries[] = [
  { ...kits, points: [{ t: "2026-09-01T00:00:00Z", value: 47 }, { t: "2026-09-02T00:00:00Z", value: 51 }] },
  { ...plus, points: [{ t: "2026-09-01T00:00:00Z", value: 32 }, { t: "2026-09-02T00:00:00Z", value: 32 }] },
];
const kitCharts: Array<[DashboardConfig["chartType"], DashboardView]> = [
  ["trend", { kind: "series", series: kitSeries, coverage }],
  ["stacked-share", { kind: "series", series: kitSeries, coverage }],
  ["table", { kind: "table", points: kitPoints, series: kitSeries, coverage, change: {} }],
  ["bars", { kind: "snapshot", points: kitPoints }],
];

describe("DashboardChart deprecated-only series", () => {
  it.each(kitCharts)("names a deprecated-only series as such in a %s chart", (chartType, view) => {
    const config: DashboardConfig = {
      scope: { kind: "all" },
      cohorts: [{ kind: "tag", tagId: "t-vue", deprecatedOnly: true }, { kind: "package", packageName: "element-plus" }],
      chartType,
      metric: "count",
    };
    const { container } = render(<DashboardChart config={config} view={view} />);
    const marks = screen.getAllByText("deprecated only");
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      let row = mark.parentElement;
      while (row && !row.textContent?.includes("vue-ui-kits")) row = row.parentElement;
      expect(row?.textContent).not.toContain("element-plus");
    }
    expect(container.textContent).toContain("element-plus");
  });

  it("keeps the last line of a two-line end label above the date labels when its series ends at zero", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1180, 320));
    const wide = { cohortKey: "component:wide", label: "Button · @example/a-package-too-long-here", color: "" };
    const config: DashboardConfig = {
      scope: { kind: "all" },
      cohorts: [{ kind: "tag", tagId: "t-vue", deprecatedOnly: true }, { kind: "component", componentId: "wide" }],
      chartType: "trend",
      metric: "count",
    };
    const series: CohortSeries[] = [
      { ...kits, points: [{ t: "2026-09-01T00:00:00Z", value: 12 }, { t: "2026-09-02T00:00:00Z", value: 0 }] },
      { ...wide, points: [{ t: "2026-09-01T00:00:00Z", value: 32 }, { t: "2026-09-02T00:00:00Z", value: 32 }] },
    ];
    const { container } = render(<DashboardChart config={config} view={{ kind: "series", series, coverage }} />);
    const mark = screen.getByText("deprecated only", { selector: "tspan" }).closest("text");
    expect(screen.getByRole("button", { name: "vue-ui-kits deprecated only" }).querySelectorAll("text")).toHaveLength(2);
    const dateTops = [...container.querySelectorAll(".recharts-xAxis-tick-labels text")].map((t) => Number(t.getAttribute("y")));
    expect(dateTops.length).toBeGreaterThan(0);
    expect(Number(mark?.getAttribute("y"))).toBeLessThan(Math.min(...dateTops));
  });
});

const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2025, 9 + i, 1)).toISOString());
const monthly = (name: string, value: (i: number) => number): CohortSeries => ({
  cohortKey: `package:${name}`,
  label: name,
  color: "",
  points: months.map((t, i) => ({ t, value: value(i) })),
});
const yearCoverage = { total: 1, repoIds: ["checkout"], points: months.map((t) => ({ t, repos: 1 })) };
const trendOf = (series: CohortSeries[], range?: DashboardConfig["range"]): [DashboardConfig, DashboardView] => [
  {
    scope: { kind: "all" },
    cohorts: series.map((s) => ({ kind: "package" as const, packageName: s.label })),
    chartType: "trend",
    metric: "count",
    ...(range ? { range } : {}),
  },
  { kind: "series", series, coverage: yearCoverage },
];
const oldUi = monthly("old-ui", (i) => (i < 6 ? 600 : 40));
const newUi = monthly("new-ui", (i) => 5 + i);
const yTop = (container: HTMLElement) =>
  Math.max(...[...container.querySelectorAll(".recharts-yAxis-tick-labels text")].map((t) => Number(t.textContent)));
const lines = (container: HTMLElement) => container.querySelectorAll(".recharts-area-curve").length;
const curve = (container: HTMLElement, key: string) => container.querySelector(`.recharts-area-curve[name="${key}"]`);
const strokeOf = (container: HTMLElement, key: string) => curve(container, key)?.getAttribute("stroke");
const swatchOf = (row: HTMLElement) => row.querySelector("button span[aria-hidden]")?.getAttribute("style");
const tableRow = (name: string) => within(screen.getByRole("table")).getAllByRole("row").find((r) => r.textContent?.startsWith(name)) as HTMLElement;

describe("DashboardChart date range", () => {
  it("offers 3 months, 6 months, 1 year and All once the scans span more than 3 months", () => {
    const [config, view] = trendOf([oldUi, newUi]);
    render(<DashboardChart config={config} view={view} range="all" onRangeChange={() => {}} />);
    const group = screen.getByRole("group", { name: "Date range" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["3 months", "6 months", "1 year", "All"]);
  });

  it("offers no range while the scans span 3 months or less", () => {
    const [config] = trendOf([oldUi, newUi]);
    render(<DashboardChart config={config} view={{ kind: "series", series, coverage }} range="all" onRangeChange={() => {}} />);
    expect(screen.queryByRole("group", { name: "Date range" })).toBeNull();
  });

  it("rescales the y-axis to the scans inside the range", () => {
    const [config, view] = trendOf([oldUi, newUi]);
    const { container, rerender } = render(<DashboardChart config={config} view={view} range="all" onRangeChange={() => {}} />);
    expect(yTop(container)).toBeGreaterThanOrEqual(600);
    rerender(<DashboardChart config={config} view={view} range="3m" onRangeChange={() => {}} />);
    expect(yTop(container)).toBeLessThan(100);
  });

  it("reports the picked preset", () => {
    const [config, view] = trendOf([oldUi, newUi]);
    const onRangeChange = vi.fn();
    render(<DashboardChart config={config} view={view} range="all" onRangeChange={onRangeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "6 months" }));
    expect(onRangeChange).toHaveBeenCalledWith("6m");
  });

  it("opens a saved chart at its saved range and keeps a picked range in the link, beside the metric", () => {
    window.history.replaceState(null, "", "http://localhost:3000/charts/c1?metric=count");
    const [config, view] = trendOf([oldUi, newUi], "3m");
    const { container } = render(<LinkedDashboardChart config={config} view={view} range="3m" />);
    expect(screen.getByRole("button", { name: "3 months" })).toHaveAttribute("aria-pressed", "true");
    expect(yTop(container)).toBeLessThan(100);
    fireEvent.click(screen.getByRole("button", { name: "1 year" }));
    expect(new URLSearchParams(window.location.search).get("range")).toBe("1y");
    expect(new URLSearchParams(window.location.search).get("metric")).toBe("count");
    expect(yTop(container)).toBeGreaterThanOrEqual(600);
  });

  it.each([
    ["trend", "all", "11 May"],
    ["stacked-share", "all", "11 May"],
    ["trend", "3m", "7 Jun"],
  ] as const)("labels a %s chart's time axis over range %s with its first day, %s, and its last", (chartType, range, first) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.id === "recharts_measurement_span" ? new DOMRect(0, 0, 6 * (this.textContent?.length ?? 0), 12) : new DOMRect(0, 0, 640, 320);
    });
    const days = Array.from({ length: 120 }, (_, i) => new Date(Date.UTC(2026, 4, 11 + i)).toISOString());
    const daily = (name: string, offset: number): CohortSeries => ({ cohortKey: `package:${name}`, label: name, color: "", points: days.map((t, i) => ({ t, value: i + offset })) });
    const [config] = trendOf([oldUi, newUi]);
    const view: DashboardView = { kind: "series", series: [daily("old-ui", 0), daily("new-ui", 5)], coverage: { total: 1, repoIds: ["checkout"], points: days.map((t) => ({ t, repos: 1 })) } };
    const { container } = render(<DashboardChart config={{ ...config, chartType }} view={view} range={range} />);
    const labels = [...container.querySelectorAll(".recharts-xAxis-tick-labels text")].map((t) => {
      const words = [...t.querySelectorAll("tspan")].map((s) => s.textContent);
      return words.length > 0 ? words.join(" ") : t.textContent;
    });
    expect(labels[0]).toBe(first);
    expect(labels.at(-1)).toBe("7 Sep");
  });
});

describe("DashboardChart legend", () => {
  it.each([
    ["a click", (entry: HTMLElement) => fireEvent.click(entry)],
    ["Enter", (entry: HTMLElement) => fireEvent.keyDown(entry, { key: "Enter" })],
    ["Space", (entry: HTMLElement) => fireEvent.keyDown(entry, { key: " " })],
  ])("shows only the line whose name at its end takes %s, and every line again on a second", (_, press) => {
    const [config, view] = trendOf([oldUi, newUi]);
    const { container } = render(<DashboardChart config={config} view={view} />);
    const entry = screen.getByRole("button", { name: "new-ui" });
    expect(entry.closest("svg")).not.toBeNull();
    press(entry);
    expect(entry).toHaveAttribute("aria-pressed", "true");
    expect(lines(container)).toBe(1);
    expect(yTop(container)).toBeLessThan(100);
    press(entry);
    expect(entry).toHaveAttribute("aria-pressed", "false");
    expect(lines(container)).toBe(2);
  });

  const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
  const latest = [30, 70, 10, 50, 20, 60];
  const many = names.map((name, n) => monthly(name, (i) => (i === 11 ? (latest[n] ?? 0) : 1)));
  const rowNames = (table: HTMLElement) => within(within(table).getAllByRole("rowgroup")[1] as HTMLElement).getAllByRole("row").map((r) => within(r).getByRole("button").textContent);

  it("lists five lines in a table, as one chart, and names none at its end", () => {
    const [config, view] = trendOf(many.slice(0, 5));
    const { container } = render(<DashboardChart config={config} view={view} />);
    expect(container.querySelectorAll(".recharts-wrapper")).toHaveLength(1);
    expect(rowNames(screen.getByRole("table"))).toHaveLength(5);
    expect(container.querySelector(".recharts-surface [role=button]")).toBeNull();
  });

  it.each([
    ["at their ends", "SkeletonContainerHeader · @example/ui", false],
    ["under the chart", `${"Skeleton".repeat(11)}Fx · @example/ui`, true],
  ] as const)("at 1180px wide, puts names %s while they take a third of the chart's width or less", (_, label, under) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1180, 320));
    const long = { ...monthly("long", () => 3), cohortKey: "component:long", label };
    const card = { ...monthly("card", () => 1), cohortKey: "component:card", label: "Card · @example/ui-kit" };
    const [config, view] = trendOf([long, card]);
    render(<DashboardChart config={config} view={view} />);
    expect(screen.getAllByRole("button", { name: /^Card/ }).map((b) => b.closest("svg") === null)).toEqual([under]);
  });

  it("names each of up to four lines in full at its end, with its package beside its name", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1180, 320));
    const long = { ...monthly("long", () => 3), cohortKey: "component:long", label: "SkeletonContainerHeader · @example/ui" };
    const card = { ...monthly("card", () => 1), cohortKey: "component:card", label: "Card · @example/ui-kit" };
    const [config, view] = trendOf([long, card]);
    const { container } = render(<DashboardChart config={config} view={view} />);
    const label = screen.getByRole("button", { name: "SkeletonContainerHeader @example/ui" });
    expect(within(label).getByText("SkeletonContainerHeader")).toBeInTheDocument();
    expect(label.querySelectorAll("text")).toHaveLength(1);
    expect(container.querySelector(".recharts-surface")?.textContent).not.toContain("…");
  });

  it("puts every package on the line beneath its name when one won't fit beside it", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1180, 320));
    const wide = { ...monthly("wide", () => 3), cohortKey: "component:wide", label: "Button · @example/a-package-too-long-here" };
    const card = { ...monthly("card", () => 1), cohortKey: "component:card", label: "Card · @example/ui" };
    const [config, view] = trendOf([wide, card]);
    render(<DashboardChart config={config} view={view} />);
    const labelLines = (name: string) => [...screen.getByRole("button", { name }).querySelectorAll("text")].map((t) => t.textContent);
    expect(labelLines("Button @example/a-package-too-long-here")).toEqual(["Button", "@example/a-package-too-long-here"]);
    expect(labelLines("Card @example/ui")).toEqual(["Card", "@example/ui"]);
  });

  it("moves a name clear of the one above it, and joins only that name to its line's end, in the line's colour", () => {
    const [config, view] = trendOf([monthly("upper", () => 50), monthly("lower", () => 50)]);
    const { container } = render(<DashboardChart config={config} view={view} />);
    expect(screen.getByRole("button", { name: "upper" }).querySelector("polyline")).toBeNull();
    expect(strokeOf(container, "package:lower")).toMatch(/^var\(--viz-/);
    expect(screen.getByRole("button", { name: "lower" }).querySelector("polyline")?.getAttribute("stroke")).toBe(strokeOf(container, "package:lower"));
  });

  it("lights a line while its name at its end has keyboard focus, and opens no tooltip", async () => {
    const [config, view] = trendOf([oldUi, newUi]);
    const { container } = render(<DashboardChart config={config} view={view} />);
    fireEvent.focus(screen.getByRole("button", { name: "new-ui" }));
    await waitFor(() => expect(curve(container, "package:old-ui")?.getAttribute("stroke-opacity")).toBe("0.25"));
    expect(curve(container, "package:new-ui")?.getAttribute("stroke-opacity")).toBe("1");
    expect(container.querySelectorAll(".recharts-tooltip-cursor").length).toBe(0);
  });

  it.each([
    [640, "at their ends", false],
    [375, "under the chart", true],
  ] as const)("at %ipx wide, names two lines %s", (width, _, under) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, width, 320));
    const [config, view] = trendOf([oldUi, newUi]);
    render(<DashboardChart config={config} view={view} />);
    expect(screen.getAllByRole("button", { name: "new-ui" }).map((b) => b.closest("svg") === null)).toEqual([under]);
  });

  it("names a line at its end while its table row is hovered, when the chart draws more than four", async () => {
    const [config, view] = trendOf(many);
    const { container } = render(<DashboardChart config={config} view={view} />);
    const surface = container.querySelector(".recharts-surface") as HTMLElement;
    expect(within(surface).queryByText("charlie")).toBeNull();
    fireEvent.mouseEnter(tableRow("charlie"));
    await waitFor(() => expect(within(surface).getByText("charlie")).toBeInTheDocument());
  });

  it("lists six lines in a table, most uses first, as one chart", () => {
    const [config, view] = trendOf(many);
    const { container } = render(<DashboardChart config={config} view={view} />);
    expect(container.querySelectorAll(".recharts-wrapper")).toHaveLength(1);
    const table = screen.getByRole("table");
    expect(rowNames(table)).toEqual(["bravo", "foxtrot", "delta", "alpha", "echo", "charlie"]);
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("70");
  });

  it("sorts the table by name", () => {
    const [config, view] = trendOf(many);
    render(<DashboardChart config={config} view={view} />);
    const table = screen.getByRole("table");
    fireEvent.click(within(table).getByRole("button", { name: "Name" }));
    expect(rowNames(table)).toEqual(names);
  });

  it("lists two lines in a table with each one's change when the chart has it, in its own column and under its uses for a narrow table", () => {
    const [config, view] = trendOf([oldUi, newUi]);
    render(<DashboardChart config={config} view={view} change={{ all: { "package:old-ui": 72, "package:new-ui": 0 } }} />);
    const rows = within(within(screen.getByRole("table")).getAllByRole("rowgroup")[1] as HTMLElement).getAllByRole("row");
    expect(rows.map((r) => [...r.querySelectorAll("td")].map((td) => [...td.childNodes].map((node) => node.textContent)))).toEqual([
      [["old-ui"], ["40", "+72"], ["+72"]],
      [["new-ui"], ["16", "0"], ["0"]],
    ]);
  });

  it.each([
    ["a migration's old component going down green", true, "deprecated", "count", -8, "−8", "text-status-ok"],
    ["a migration's old component going up red", true, "deprecated", "count", 3, "+3", "text-status-err"],
    ["a migration's replacement going up green", true, "successor", "count", 9, "+9", "text-status-ok"],
    ["a migration's replacement going down red", true, "successor", "count", -2, "−2", "text-status-err"],
    ["no change muted", true, "deprecated", "count", 0, "0", "text-muted-foreground"],
    ["a share change too small to show muted", true, "deprecated", "share", -0.0002, "0", "text-muted-foreground"],
    ["a migration's line with no role muted", true, undefined, "count", 5, "+5", "text-muted-foreground"],
    ["a saved chart's deprecated line going down muted", false, "deprecated", "count", -8, "−8", "text-muted-foreground"],
    ["a saved chart's deprecated line going up muted", false, "deprecated", "count", 3, "+3", "text-muted-foreground"],
  ] as const)("shows %s in the Change column", (_, migration, role, metric, delta, text, tone) => {
    const line = { ...monthly("line", () => 10), ...(role ? { role } : {}) };
    const [config, view] = trendOf([line, monthly("other", () => 1)]);
    render(<DashboardChart config={{ ...config, metric }} view={view} change={{ all: { "package:line": delta } }} migration={migration} />);
    const cell = within(screen.getByRole("table")).getByRole("button", { name: /line/ }).closest("tr")?.querySelectorAll("td")[2];
    expect(cell).toHaveTextContent(text);
    expect(["text-status-ok", "text-status-err", "text-muted-foreground"].filter((c) => cell?.classList.contains(c))).toEqual([tone]);
  });

  const twoDays = (name: string): CohortSeries => ({ cohortKey: `package:${name}`, label: name, color: "", points: series[0]?.points ?? [] });
  const shortSpan: DashboardView = { kind: "series", series: [twoDays("old-ui"), twoDays("new-ui")], coverage };
  it.each([
    ["3 months", trendOf([oldUi, newUi])[1], "3m", "Change since 1 Jun", "+3"],
    ["6 months", trendOf([oldUi, newUi])[1], "6m", "Change since 1 Mar", "+6"],
    ["1 year, which reaches back past the first scan", trendOf([oldUi, newUi])[1], "1y", "Change since 1 Oct", "+9"],
    ["All", trendOf([oldUi, newUi])[1], "all", "Change since 1 Oct", "+11"],
    ["a saved 3 months over scans that span less, which offers no range", shortSpan, "3m", "Change since 1 Sep", "+3"],
  ] as const)("at %s, heads Change with the day the chart starts and shows the change since then", (_, view, range, heading, delta) => {
    const [config] = trendOf([oldUi, newUi]);
    const change = { "3m": { "package:new-ui": 3 }, "6m": { "package:new-ui": 6 }, "1y": { "package:new-ui": 9 }, all: { "package:new-ui": 11 } };
    render(<DashboardChart config={config} view={view} range={range} onRangeChange={() => {}} change={change} />);
    const table = screen.getByRole("table");
    const headings = within(table).getAllByRole("button", { name: heading });
    expect(headings).toHaveLength(2);
    for (const button of headings) {
      expect(button).toHaveTextContent(heading);
      expect(button).toHaveAttribute("title", heading);
    }
    const row = within(table).getAllByRole("row").find((r) => r.textContent?.startsWith("new-ui"));
    expect(row?.querySelectorAll("td")[2]).toHaveTextContent(delta);
  });

  it("sorts by change from its own heading or the one under Uses for a narrow table, marks both sorted, and lists lines with nothing to compare last", () => {
    const [config, view] = trendOf([oldUi, newUi, monthly("mid-ui", () => 20)]);
    render(<DashboardChart config={config} view={view} change={{ all: { "package:old-ui": 72, "package:new-ui": -5, "package:mid-ui": null } }} />);
    const table = screen.getByRole("table");
    const [own, stacked] = within(table).getAllByRole("button", { name: "Change since 1 Oct" }) as [HTMLElement, HTMLElement];
    const sorted = () => within(table).getAllByRole("columnheader").flatMap((head) => (head.contains(own) || head.contains(stacked) ? [head.getAttribute("aria-sort")] : []));
    fireEvent.click(own);
    expect(rowNames(table)).toEqual(["old-ui", "new-ui", "mid-ui"]);
    expect(sorted()).toEqual(["descending", "descending"]);
    fireEvent.click(stacked);
    expect(rowNames(table)).toEqual(["new-ui", "old-ui", "mid-ui"]);
    expect(sorted()).toEqual(["ascending", "ascending"]);
  });

  it.each([
    ["the first folder from the end that differs", ["ui/elements/Button.tsx", "ui/fields/Button.tsx"], ["elements", "fields"]],
    ["the first folder that differs above a shared one", ["src/fixed/Toolbar/index.tsx", "src/inline/Toolbar/index.tsx"], ["fixed", "inline"]],
    ["the file names when they differ", ["src/badges/Badge.tsx", "src/badges/StatusBadge.tsx"], ["Badge.tsx", "StatusBadge.tsx"]],
    ["the file names with their folders when one is an index file", ["fields/component/index.tsx", "fields/components/RelationshipComponent.tsx"], ["component/index.tsx", "components/RelationshipComponent.tsx"]],
    ["as many folders as it takes when one alone repeats", ["a/x/Card.tsx", "b/x/Card.tsx", "a/y/Card.tsx"], ["a/x", "b/x", "a/y"]],
  ] as const)("tells same-named components apart under their table rows by %s, and shows nothing under a name no other row has", (_, paths, shown) => {
    const named = (id: string, label: string) => ({ ...monthly(id, () => 1), cohortKey: `component:${id}`, label });
    const same = paths.map((_, i) => named(`same-${i}`, "Card · @acme/ui"));
    const [config, view] = trendOf([...same, named("popup", "Popup · @acme/ui")]);
    const pathOf = Object.fromEntries([...paths.map((path, i) => [`component:same-${i}`, path]), ["component:popup", "ui/overlays/Popup.tsx"]]);
    render(<DashboardChart config={config} view={view} change={{ all: {} }} paths={pathOf} />);
    const table = screen.getByRole("table");
    expect(paths.map((path) => within(table).getByTitle(path).textContent)).toEqual(shown);
    expect(within(table).queryByTitle("ui/overlays/Popup.tsx")).toBeNull();
  });

  const twelve = ["bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "alpha"].map((name, n) =>
    monthly(`@acme/${name}`, () => 120 - n * 10),
  );
  const toolbar = { ...monthly("toolbar", () => 5), cohortKey: "component:toolbar", label: "Toolbar · @other/kit" };
  twelve.push(toolbar);

  it("lists ten lines with no search box and no Show all", () => {
    const [config, view] = trendOf(twelve.slice(0, 10));
    render(<DashboardChart config={config} view={view} />);
    expect(rowNames(screen.getByRole("table"))).toHaveLength(10);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("lists the first 10 of 12 lines in the table's sort, every line after Show all, and 10 again after Show fewer", () => {
    const [config, view] = trendOf(twelve);
    render(<DashboardChart config={config} view={view} />);
    const table = screen.getByRole("table");
    expect(rowNames(table)).toEqual(["bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo"].map((n) => `@acme/${n}`));
    fireEvent.click(screen.getByRole("button", { name: "Show all 12" }));
    expect(rowNames(table)).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(rowNames(table)).toHaveLength(10);
    fireEvent.click(within(table).getByRole("button", { name: "Name" }));
    expect(rowNames(table)[0]).toBe("@acme/alpha");
  });

  it("finds every line whose component or package name matches the search, past the tenth too, and says when none does", () => {
    const [config, view] = trendOf(twelve);
    render(<DashboardChart config={config} view={view} />);
    const table = screen.getByRole("table");
    const search = screen.getByRole("searchbox", { name: "Search series by component or package name" });
    fireEvent.change(search, { target: { value: "TOOLBAR" } });
    expect(rowNames(table)).toEqual(["Toolbar@other/kit"]);
    fireEvent.change(search, { target: { value: "other/kit" } });
    expect(rowNames(table)).toEqual(["Toolbar@other/kit"]);
    fireEvent.change(search, { target: { value: "@acme" } });
    expect(rowNames(table)).toHaveLength(11);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText(/No series match/)).toHaveTextContent("No series match zzz.");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(rowNames(table)).toHaveLength(10);
  });

  it("finds a line by the package its name leaves out", () => {
    const menu = { ...monthly("menu", () => 3), cohortKey: "record:menu", label: "Menu", packageName: "@other/kit" };
    const [config, view] = trendOf([...twelve, menu]);
    render(<DashboardChart config={config} view={view} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "@other/kit" } });
    expect(rowNames(screen.getByRole("table"))).toEqual(["Toolbar@other/kit", "Menu"]);
  });

  const search = (value: string) => fireEvent.change(screen.getByRole("searchbox"), { target: { value } });

  it("draws only the lines that match the search, with the y-axis fitted to them, and every line once it's cleared", () => {
    const [config, view] = trendOf(twelve);
    const { container } = render(<DashboardChart config={config} view={view} />);
    expect(lines(container)).toBe(12);
    expect(yTop(container)).toBeGreaterThanOrEqual(120);
    search("toolbar");
    expect(lines(container)).toBe(1);
    expect(yTop(container)).toBeLessThanOrEqual(10);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(lines(container)).toBe(12);
  });

  it("leaves the chart as it is when no line matches the search", () => {
    const [config, view] = trendOf(twelve);
    const { container } = render(<DashboardChart config={config} view={view} />);
    search("zzz");
    expect(lines(container)).toBe(12);
    expect(yTop(container)).toBeGreaterThanOrEqual(120);
  });

  it("draws a line pressed inside a search on its own, and the matching lines again on a second press", () => {
    const [config, view] = trendOf(twelve);
    const { container } = render(<DashboardChart config={config} view={view} />);
    search("@acme");
    expect(lines(container)).toBe(11);
    const row = within(screen.getByRole("table")).getByRole("button", { name: /delta$/ });
    fireEvent.click(row);
    expect(lines(container)).toBe(1);
    fireEvent.click(row);
    expect(lines(container)).toBe(11);
  });

  const strokes = (container: HTMLElement) =>
    Object.fromEntries([...container.querySelectorAll(".recharts-area-curve")].map((c) => [c.getAttribute("name"), c.getAttribute("stroke")]));
  it.each([
    ["a search narrows the chart", () => search("el")],
    ["a line is shown on its own", () => fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: /hotel$/ }))],
  ])("keeps each drawn line's colour while %s", (_, narrow) => {
    const [config, view] = trendOf(twelve);
    const { container } = render(<DashboardChart config={config} view={view} />);
    const before = strokes(container);
    narrow();
    const drawn = strokes(container);
    expect(Object.keys(drawn).length).toBeLessThan(12);
    expect(drawn).toEqual(Object.fromEntries(Object.keys(drawn).map((key) => [key, before[key]])));
  });

  it("keeps the row of a line shown on its own past the tenth, through a search it doesn't match and once the search is cleared", () => {
    const [config, view] = trendOf(twelve);
    render(<DashboardChart config={config} view={view} />);
    const table = screen.getByRole("table");
    search("toolbar");
    fireEvent.click(within(table).getByRole("button", { name: /^Toolbar/ }));
    search("@acme/bravo");
    expect(rowNames(table)).toEqual(["@acme/bravo", "Toolbar@other/kit"]);
    search("zzz");
    expect(within(table).getByRole("button", { name: /^Toolbar/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/No series match/)).toHaveTextContent("No series match zzz.");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(rowNames(table)).toHaveLength(11);
    expect(within(table).getByRole("button", { name: /^Toolbar/ })).toHaveAttribute("aria-pressed", "true");
  });

  it.each([
    ["its name", (row: HTMLElement) => within(row).getByRole("button")],
    ["its Uses cell, outside the name", (row: HTMLElement) => row.querySelectorAll("td")[1] as HTMLElement],
  ])("shows only the line whose table row is clicked on %s, and every line again on a second click", (_, target) => {
    const [config, view] = trendOf(many);
    const { container } = render(<DashboardChart config={config} view={view} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(target(tableRow("delta")));
    expect(within(tableRow("delta")).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(lines(container)).toBe(1);
    fireEvent.click(target(tableRow("delta")));
    expect(within(tableRow("delta")).getByRole("button")).toHaveAttribute("aria-pressed", "false");
    expect(lines(container)).toBe(6);
  });

  it("leaves every line shown when a drag that selects text in a table row ends, and shows only that line on a click while the text stays selected", () => {
    const [config, view] = trendOf(many);
    const { container } = render(<DashboardChart config={config} view={view} />);
    const uses = tableRow("delta").querySelectorAll("td")[1] as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(uses);
    window.getSelection()?.addRange(range);
    fireEvent.mouseDown(uses, { clientX: 100, clientY: 10 });
    fireEvent.click(uses, { clientX: 40, clientY: 10, detail: 1 });
    expect(lines(container)).toBe(6);
    fireEvent.mouseDown(uses, { clientX: 40, clientY: 10 });
    fireEvent.click(uses, { clientX: 40, clientY: 10, detail: 1 });
    expect(lines(container)).toBe(1);
    window.getSelection()?.removeAllRanges();
  });
});

describe("DashboardChart line colours", () => {
  it("colours lines in turn in saved order, whatever their uses, and keys each table row in its line's colour", () => {
    const kits = [30, 70, 10, 50, 20, 60, 40, 80].map((value, n) => monthly(`kit-${"abcdefgh"[n]}`, (i) => (i === 11 ? value : 1)));
    const [config, view] = trendOf(kits);
    const { container } = render(<DashboardChart config={config} view={view} />);
    const turn = ["primary", "cat-2", "cat-3", "cat-4", "cat-5", "primary", "cat-2", "cat-3"].map((token) => `var(--viz-${token})`);
    expect(kits.map((kit) => strokeOf(container, kit.cohortKey))).toEqual(turn);
    expect(kits.map((kit) => swatchOf(tableRow(kit.label))?.includes(strokeOf(container, kit.cohortKey) ?? "-"))).toEqual(kits.map(() => true));
  });
});

describe("DashboardChart lit line", () => {
  const flat = [5, 15, 25, 35, 45, 55].map((value, n) => monthly(`level-${n}`, () => value));
  // A flat line's y on the plot: its path's first point.
  const lineY = (container: HTMLElement, key: string) => Number(curve(container, key)?.getAttribute("d")?.match(/^M[\d.]+,([\d.]+)/)?.[1]);
  const plotRight = (container: HTMLElement) => Math.max(...[...container.querySelectorAll(".recharts-cartesian-grid-horizontal line")].map((l) => Number(l.getAttribute("x2"))));
  const opacities = (container: HTMLElement) => Object.fromEntries([...container.querySelectorAll(".recharts-area-curve")].map((c) => [c.getAttribute("name"), c.getAttribute("stroke-opacity")]));
  const litOnly = (key: string) => Object.fromEntries(flat.map((s) => [s.cohortKey, s.cohortKey === key ? "1" : "0.25"]));
  const noneLit = Object.fromEntries(flat.map((s) => [s.cohortKey, "1"]));

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(320);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["its table row is hovered", (row: HTMLElement) => fireEvent.mouseEnter(row), (row: HTMLElement) => fireEvent.mouseLeave(row)],
    ["its name in the table has keyboard focus", (row: HTMLElement) => fireEvent.focus(within(row).getByRole("button")), (row: HTMLElement) => fireEvent.blur(within(row).getByRole("button"))],
  ])("lights a line in its own colour and dims every other line while %s, and the next line once the next row's is", (_, enter, leave) => {
    const [config, view] = trendOf(flat);
    const { container } = render(<DashboardChart config={config} view={view} />);
    const colour = strokeOf(container, "package:level-0");
    enter(tableRow("level-0"));
    expect(strokeOf(container, "package:level-0")).toBe(colour);
    expect(opacities(container)).toEqual(litOnly("package:level-0"));
    enter(tableRow("level-1"));
    expect(opacities(container)).toEqual(litOnly("package:level-1"));
    leave(tableRow("level-1"));
    expect(opacities(container)).toEqual(noneLit);
  });

  it("lights the line under the pointer on the plot, and none where the pointer is clear of every line", async () => {
    const [config, view] = trendOf(flat);
    const { container } = render(<DashboardChart config={config} view={view} />);
    const plot = container.querySelector(".recharts-wrapper") as HTMLElement;
    fireEvent.mouseMove(plot, { clientX: 320, clientY: lineY(container, "package:level-0") });
    await waitFor(() => expect(opacities(container)).toEqual(litOnly("package:level-0")));
    fireEvent.mouseMove(plot, { clientX: 320, clientY: (lineY(container, "package:level-0") + lineY(container, "package:level-1")) / 2 });
    await waitFor(() => expect(opacities(container)).toEqual(noneLit));
  });

  it.each([
    ["", () => {}],
    [" after it was shown on its own and every line shown again", () => {
      fireEvent.click(within(tableRow("twin")).getByRole("button"));
      fireEvent.click(within(tableRow("twin")).getByRole("button"));
    }],
  ])("lights the line later in the chart's order where two lines share a value, as the tooltip marks it%s", async (_, before) => {
    const twins = [...flat, monthly("twin", () => 5)];
    const [config, view] = trendOf(twins);
    const { container } = render(<DashboardChart config={config} view={view} />);
    before();
    const plot = container.querySelector(".recharts-wrapper") as HTMLElement;
    fireEvent.mouseMove(plot, { clientX: 320, clientY: lineY(container, "package:level-0") });
    await waitFor(() => expect(opacities(container)).toEqual(Object.fromEntries(twins.map((s) => [s.cohortKey, s.cohortKey === "package:twin" ? "1" : "0.25"]))));
    expect([...container.querySelectorAll(".recharts-tooltip-wrapper span.tabular-nums.font-semibold")].map((value) => value.parentElement?.textContent)).toEqual(["twin5"]);
  });

  it("lights nothing on the plot, and the tooltip marks no row, where only one line has a value", async () => {
    const late = monthly("late", (i) => 50 + i);
    const [config, view] = trendOf([monthly("early", () => 5), { ...late, points: late.points.slice(8) }]);
    const { container } = render(<DashboardChart config={config} view={view} />);
    const plot = container.querySelector(".recharts-wrapper") as HTMLElement;
    const early = lineY(container, "package:early");
    fireEvent.mouseMove(plot, { clientX: 120, clientY: early });
    await waitFor(() => expect(container.querySelector(".recharts-tooltip-cursor")).not.toBeNull());
    expect(opacities(container)).toEqual({ "package:early": "1", "package:late": "1" });
    expect(container.querySelectorAll(".recharts-tooltip-wrapper span.tabular-nums.font-semibold")).toHaveLength(0);
  });

  it("pins the tooltip on a click on the plot, and not on a click on a line's name at its end", async () => {
    const [config, view] = trendOf([oldUi, newUi]);
    const { container } = render(<DashboardChart config={config} view={view} />);
    const plot = container.querySelector(".recharts-wrapper") as HTMLElement;
    const pinned = () => (container.querySelector(".recharts-tooltip-wrapper") as HTMLElement).style.pointerEvents === "auto";
    fireEvent.mouseMove(plot, { clientX: 320, clientY: 100 });
    await waitFor(() => expect(container.querySelector(".recharts-tooltip-cursor")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "new-ui" }));
    expect(lines(container)).toBe(1);
    expect(pinned()).toBe(false);
    fireEvent.click(plot, { clientX: 320, clientY: 100 });
    expect(pinned()).toBe(true);
  });

  it("lights nothing while the pointer is beside the plot", async () => {
    const [config, view] = trendOf(flat);
    const { container } = render(<DashboardChart config={config} view={view} />);
    const plot = container.querySelector(".recharts-wrapper") as HTMLElement;
    const y = lineY(container, "package:level-0");
    fireEvent.mouseMove(plot, { clientX: 320, clientY: y });
    await waitFor(() => expect(opacities(container)).toEqual(litOnly("package:level-0")));
    fireEvent.mouseMove(plot, { clientX: plotRight(container) + 8, clientY: y });
    await waitFor(() => expect(opacities(container)).toEqual(noneLit));
  });
});
