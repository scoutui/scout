// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GovernanceTracking } from "@scoutui/web-shared";
import { TrackingReadout, TrackingSection } from "@/components/dashboards/tracking-rows";

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
    recordIds: ["r1"],
    name: "Migration: OldButton → new-ds",
    from: [{ grain: "component", targetPackage: "old-ds", targetExport: "OldButton" }],
    fromLabel: "OldButton · old-ds",
    toLabel: "new-ds/Button",
    config: { scope: { kind: "all" }, cohorts: [], chartType: "trend", metric: "count" },
    series: [],
    coverage: { total: 1, points: [] },
    active: true,
    remaining: 5,
    progress: 0.5,
    delta: 2,
    reposAdded: 0,
    ...over,
  };
}

describe("TrackingSection change in what is left", () => {
  it.each(["migration", "retirement"] as const)("a %s row reads the change in what is left, and the repos added", kind => {
    render(
      <TrackingSection
        kind={kind}
        surface="estate"
        entries={[
          entry({ id: `${kind}:fewer`, kind, delta: -3, reposAdded: 1 }),
          entry({ id: `${kind}:more`, kind, delta: 2 }),
          entry({ id: `${kind}:still`, kind, delta: 0 }),
        ]}
      />,
    );
    expect(screen.getByText("3 fewer")).toHaveClass("text-status-ok");
    expect(screen.getByText("2 more")).toHaveClass("text-status-err");
    expect(screen.getByText("no change")).not.toHaveClass("text-status-ok", "text-status-err");
    expect(screen.getAllByText(/repo added/)).toHaveLength(1);
  });

  it("a migration row reads what is left beside the share migrated", () => {
    render(<TrackingSection kind="migration" surface="estate" entries={[entry({ remaining: 24, progress: 0.4 })]} />);
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("left")).toBeInTheDocument();
  });

  it.each([
    ["estate", "Migrations · 1 in progress · change over the last 30 days"],
    ["repo", "Migrations in this repo · 1 in progress · change over the last 30 days"],
  ] as const)("the %s heading names the period the change covers", (surface, heading) => {
    render(<TrackingSection kind="migration" surface={surface} entries={[entry({})]} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(heading);
  });
});

describe("TrackingReadout", () => {
  it.each([
    [{}, "50% migrated · 5 left · 2 more in the last 30 days"],
    [{ delta: -14, reposAdded: 1 }, "50% migrated · 5 left · 14 fewer in the last 30 days · 1 repo added"],
    [{ delta: null }, "50% migrated · 5 left"],
    [{ progress: null, remaining: 0, delta: null }, "— migrated · 0 left"],
    [{ kind: "retirement" as const, progress: null, delta: 0 }, "5 left · no change in the last 30 days"],
  ])("reads %o as %s", (over, text) => {
    const { container } = render(<TrackingReadout entry={entry(over)} />);
    expect(container.textContent).toBe(text);
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
    expect(screen.getByText(/Migrations · 1 in progress · 1 complete · change over the last 30 days/)).toBeDefined();
    expect(screen.getByText("Show 1 complete")).toBeDefined();
    expect(screen.getByText("100%")).toBeDefined(); // formatPct trim
    expect(screen.getByText("complete")).toBeDefined(); // archived Δ slot label
    expect(screen.queryByText("no change")).toBeNull();
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
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Migrations · 2 in progress · change over the last 30 days");
    expect(screen.queryByText(/median/)).toBeNull();
  });
});

describe("RepoRow expanded chart", () => {
  it("a migration row opens onto the count-trend chart: share is the readout, never a second chart", async () => {
    render(<TrackingSection kind="migration" entries={[entry({})]} surface="repo" preExpand />);
    expect((await screen.findByTestId("trend-chart")).getAttribute("data-metric")).toBe("count");
    expect(screen.getAllByTestId("trend-chart")).toHaveLength(1);
  });

  it("a migration row whose repo has no use of the old component says there's nothing to migrate instead of a chart", async () => {
    const unused = entry({ id: "migration:unused", active: false, remaining: 0, progress: null, delta: null, coverage: { total: 0, points: [] } });
    const done = entry({ id: "migration:done", active: false, remaining: 0, progress: 1, delta: null });
    render(<TrackingSection kind="migration" entries={[]} complete={[unused, done]} surface="repo" />);
    expect(screen.getByText("No scan of this repo has found a use of OldButton · old-ds, so there's nothing to migrate.")).toBeInTheDocument();
    expect(await screen.findAllByTestId("trend-chart")).toHaveLength(1);
  });
});
