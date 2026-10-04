// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const coverage = { total: 1, points: [{ t: "2026-09-01T00:00:00Z", repos: 1 }, { t: "2026-09-02T00:00:00Z", repos: 1 }] };

const charts: Array<[DashboardConfig["chartType"], DashboardView]> = [
  ["trend", { kind: "series", series, coverage }],
  ["stacked-share", { kind: "series", series, coverage }],
  ["table", { kind: "table", points, series, coverage }],
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
  ["table", { kind: "table", points: kitPoints, series: kitSeries, coverage }],
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

  it("keeps a deprecated-only end label above the date labels when its series ends at zero", () => {
    const config: DashboardConfig = {
      scope: { kind: "all" },
      cohorts: [{ kind: "tag", tagId: "t-vue", deprecatedOnly: true }, { kind: "package", packageName: "element-plus" }],
      chartType: "trend",
      metric: "count",
    };
    const series: CohortSeries[] = [
      { ...kits, points: [{ t: "2026-09-01T00:00:00Z", value: 12 }, { t: "2026-09-02T00:00:00Z", value: 0 }] },
      { ...plus, points: [{ t: "2026-09-01T00:00:00Z", value: 32 }, { t: "2026-09-02T00:00:00Z", value: 32 }] },
    ];
    const { container } = render(<DashboardChart config={config} view={{ kind: "series", series, coverage }} />);
    const mark = screen.getByText("deprecated only", { selector: "tspan" });
    const label = mark.parentElement;
    const baseline =
      Number(label?.getAttribute("y") ?? Number.NaN) +
      Number(label?.getAttribute("dy") ?? Number.NaN) +
      Number(mark.getAttribute("dy") ?? Number.NaN);
    const dateTops = [...container.querySelectorAll(".recharts-xAxis-tick-labels text")].map((t) => Number(t.getAttribute("y")));
    expect(dateTops.length).toBeGreaterThan(0);
    expect(baseline).toBeLessThan(Math.min(...dateTops));
  });
});

const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2025, 9 + i, 1)).toISOString());
const monthly = (name: string, value: (i: number) => number): CohortSeries => ({
  cohortKey: `package:${name}`,
  label: name,
  color: "",
  points: months.map((t, i) => ({ t, value: value(i) })),
});
const yearCoverage = { total: 1, points: months.map((t) => ({ t, repos: 1 })) };
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
});

describe("DashboardChart legend", () => {
  it("shows only the clicked series, and every series again on a second click", () => {
    const [config, view] = trendOf([oldUi, newUi]);
    const { container } = render(<DashboardChart config={config} view={view} />);
    const entry = screen.getByRole("button", { name: "new-ui" });
    fireEvent.click(entry);
    expect(entry).toHaveAttribute("aria-pressed", "true");
    expect(lines(container)).toBe(1);
    expect(yTop(container)).toBeLessThan(100);
    fireEvent.click(entry);
    expect(entry).toHaveAttribute("aria-pressed", "false");
    expect(lines(container)).toBe(2);
  });

  const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
  const latest = [30, 70, 10, 50, 20, 60];
  const many = names.map((name, n) => monthly(name, (i) => (i === 11 ? (latest[n] ?? 0) : 1)));
  const rowNames = (table: HTMLElement) => within(table).getAllByRole("row").slice(1).map((r) => within(r).getByRole("button").textContent);

  it("draws five lines as one chart with an entry for each", () => {
    const [config, view] = trendOf(many.slice(0, 5));
    const { container } = render(<DashboardChart config={config} view={view} />);
    expect(container.querySelectorAll(".recharts-wrapper")).toHaveLength(1);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "echo" })).toBeInTheDocument();
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

  it("shows only the line whose table row is clicked", () => {
    const [config, view] = trendOf(many);
    const { container } = render(<DashboardChart config={config} view={view} />);
    const row = within(screen.getByRole("table")).getByRole("button", { name: "delta" });
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(lines(container)).toBe(1);
  });
});
