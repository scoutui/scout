// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CohortPoint, CohortSeries, DashboardConfig, DashboardView } from "@scoutui/web-shared";
import { DashboardChart } from "@/components/dashboards/dashboard-chart";

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
