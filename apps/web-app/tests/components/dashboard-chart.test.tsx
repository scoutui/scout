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

const charts: Array<[DashboardConfig["chartType"], DashboardView]> = [
  ["trend", { kind: "series", series }],
  ["stacked-share", { kind: "series", series }],
  ["table", { kind: "table", points, series }],
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
