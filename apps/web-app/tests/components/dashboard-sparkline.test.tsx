// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { CohortSeries, DashboardConfig } from "@scoutui/web-shared";
import { DashboardSparkline } from "@/components/dashboards/dashboard-sparkline";

const trend: DashboardConfig = { scope: { kind: "all" }, cohorts: [], chartType: "trend", metric: "count" };
const points = (values: number[]) => values.map((value, i) => ({ t: `2026-01-0${i + 1}T00:00:00Z`, value }));
const dep: CohortSeries = { cohortKey: "component:old", label: "Old", color: "", role: "deprecated", points: points([10, 8, 6]) };
const coverage = { total: 1, points: [] };
const succ: CohortSeries = { cohortKey: "package:@x/new", label: "@x/new", color: "", role: "successor", points: points([2, 4, 6]) };

function washedPaths(container: HTMLElement): number {
  return container.querySelectorAll('path[fill^="url("]').length;
}
function linePaths(container: HTMLElement): number {
  return container.querySelectorAll('path[fill="none"]').length;
}

describe("DashboardSparkline trend mini", () => {
  it("a migration pair draws two lines but washes only the successor", () => {
    const { container } = render(<DashboardSparkline uid="m" config={trend} view={{ kind: "series", series: [dep, succ], coverage }} />);
    expect(linePaths(container)).toBe(2);
    expect(washedPaths(container)).toBe(1);
  });

  it("a lone deprecated series (a retirement) keeps its wash", () => {
    const { container } = render(<DashboardSparkline uid="r" config={trend} view={{ kind: "series", series: [dep], coverage }} />);
    expect(linePaths(container)).toBe(1);
    expect(washedPaths(container)).toBe(1);
  });
});

describe("DashboardSparkline without a stored preview", () => {
  it("renders the empty mini", () => {
    const { container } = render(<DashboardSparkline uid="none" config={trend} view={null} />);
    expect(container.querySelectorAll("svg line")).toHaveLength(1);
    expect(linePaths(container)).toBe(0);
  });
});
