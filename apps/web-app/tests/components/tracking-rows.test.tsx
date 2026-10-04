// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GovernanceTracking } from "@scoutui/web-shared";
import { TrackingSection } from "@/components/dashboards/tracking-rows";

// The sparkline would pull recharts into jsdom, and no assertion needs it.
vi.mock("@/components/dashboards/dashboard-sparkline", () => ({
  DashboardSparkline: () => null,
}));
// The expanded row's chart is recharts too; assert on which chart is chosen, not its SVG.
vi.mock("@/components/dashboards/cohort-trend-chart", () => ({
  CohortTrendChart: ({ metric }: { metric: string }) => <div data-testid="trend-chart" data-metric={metric} />,
}));

function entry(over: Partial<GovernanceTracking>): GovernanceTracking {
  return {
    id: "migration:r1",
    kind: "migration",
    record: {} as never,
    name: "Migration: OldButton → new-ds",
    fromLabel: "OldButton · old-ds",
    toLabel: "new-ds/Button",
    config: { scope: { kind: "all" }, cohorts: [], chartType: "trend", metric: "count" },
    series: [],
    coverage: { total: 1, points: [] },
    active: true,
    remaining: 5,
    progress: 0.5,
    delta: 2,
    ...over,
  };
}

describe("TrackingSection change since the previous scan", () => {
  it.each(["migration", "retirement"] as const)("a %s row reads 'repo added' instead of the change when the latest scan is a repo's first", kind => {
    const joined = { total: 2, points: [{ t: "2026-09-01T00:00:00Z", repos: 1 }, { t: "2026-10-01T00:00:00Z", repos: 2 }] };
    render(
      <TrackingSection
        kind={kind}
        surface="estate"
        entries={[
          entry({ id: `${kind}:joined`, kind, coverage: joined }),
          entry({ id: `${kind}:joined-unchanged`, kind, coverage: joined, delta: 0 }),
          entry({ id: `${kind}:steady`, kind }),
        ]}
      />,
    );
    expect(screen.getAllByText("repo added")).toHaveLength(1);
    expect(screen.getByText("±0 since previous scan")).toBeInTheDocument();
    expect(screen.getAllByText(/^(up|down) from .* previously$/)).toHaveLength(1);
  });
});

describe("TrackingSection complete ledger", () => {
  it("renders in-progress rows plus a 'Show N complete' band; archived row reads plain 'complete'", () => {
    render(
      <TrackingSection
        kind="migration"
        entries={[entry({ progress: null, delta: null })]}
        complete={[entry({ id: "migration:r2", active: false, remaining: 0, progress: 1, delta: null })]}
        surface="estate"
      />,
    );
    expect(screen.getByText(/Migrations · 1 in progress · 1 complete/)).toBeDefined();
    expect(screen.getByText("Show 1 complete")).toBeDefined();
    expect(screen.getByText("100%")).toBeDefined(); // formatPct trim
    expect(screen.getByText("complete")).toBeDefined(); // archived Δ slot label
    expect(screen.queryByText("±0 since previous scan")).toBeNull();
  });

  it("a complete-only section renders with no in-progress fragment in the heading", () => {
    render(
      <TrackingSection
        kind="migration"
        entries={[]}
        complete={[entry({ id: "migration:r2", active: false, remaining: 0, progress: 1, delta: null })]}
        surface="estate"
      />,
    );
    expect(screen.getByText("Migrations · 1 complete")).toBeDefined();
    expect(screen.queryByText(/0 in progress/)).toBeNull();
  });

  it("renders nothing with zero entries of either kind", () => {
    const { container } = render(<TrackingSection kind="retirement" entries={[]} complete={[]} surface="estate" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("TrackingSection heading", () => {
  it("does not put a median progress figure in the heading", () => {
    render(
      <TrackingSection
        kind="migration"
        entries={[entry({ id: "migration:r1", progress: 0.13 }), entry({ id: "migration:r2", progress: 0.5 })]}
        surface="estate"
      />,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Migrations · 2 in progress");
    expect(screen.queryByText(/median/)).toBeNull();
  });
});

describe("RepoRow expanded chart", () => {
  it("a migration row opens onto the count-trend chart: share is the readout, never a second chart", async () => {
    render(<TrackingSection kind="migration" entries={[entry({})]} surface="repo" preExpand />);
    expect((await screen.findByTestId("trend-chart")).getAttribute("data-metric")).toBe("count");
    expect(screen.getAllByTestId("trend-chart")).toHaveLength(1);
  });
});
