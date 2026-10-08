// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { CohortSeries, DashboardConfig } from "@scoutui/web-shared";
import { DashboardSparkline } from "@/components/dashboards/dashboard-sparkline";

const trend: DashboardConfig = { scope: { kind: "all" }, cohorts: [], chartType: "trend", metric: "count" };
const points = (values: number[]) => values.map((value, i) => ({ t: `2026-01-0${i + 1}T00:00:00Z`, value }));
const dep: CohortSeries = { cohortKey: "component:old", label: "Old", color: "", role: "deprecated", points: points([10, 8, 6]) };
const coverage = { total: 1, repoIds: ["checkout"], points: [] };
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

describe("DashboardSparkline over time", () => {
  const at = (days: string[], values: number[]) => days.map((day, i) => ({ t: `${day}T00:00:00Z`, value: values[i] ?? 0 }));
  const xs = (container: HTMLElement) => {
    const d = container.querySelector("svg path:not([fill^='url('])")?.getAttribute("d") ?? "";
    return [...new Set([...d.matchAll(/[ML]([\d.]+),/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  };
  const eleventhDay = ["2026-01-01", "2026-01-02", "2026-01-11"];
  const overAYear = ["2025-11-01", "2026-07-01", "2026-10-01", "2026-11-01"];

  it.each([
    ["a trend spaces its scans by date", "trend", undefined, eleventhDay, [3, 13.6, 109]],
    ["a stacked chart spaces its scans by date", "stacked-share", undefined, eleventhDay, [3, 13.6, 109]],
    ["a trend shows only its saved range", "trend", "3m", overAYear, [3, 73.3, 109]],
    ["a stacked chart shows only its saved range", "stacked-share", "3m", overAYear, [3, 73.3, 109]],
  ] as const)("%s", (_, chartType, range, days, expected) => {
    const config: DashboardConfig = { ...trend, chartType, ...(range ? { range } : {}) };
    const series: CohortSeries[] = [
      { cohortKey: "a", label: "A", color: "", points: at(days, [4, 5, 6, 7]) },
      { cohortKey: "b", label: "B", color: "", points: at(days, [2, 2, 3, 3]) },
    ];
    const { container } = render(<DashboardSparkline uid="d" config={config} view={{ kind: "series", series, coverage }} />);
    expect(xs(container)).toEqual(expected);
  });
});

describe("DashboardSparkline without a stored preview", () => {
  it("renders the empty mini", () => {
    const { container } = render(<DashboardSparkline uid="none" config={trend} view={null} />);
    expect(container.querySelectorAll("svg line")).toHaveLength(1);
    expect(linePaths(container)).toBe(0);
  });
});
