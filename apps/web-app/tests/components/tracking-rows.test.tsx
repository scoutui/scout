// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { GovernanceTracking } from "@scoutui/web-shared";
import { TrackingReadout } from "@/components/dashboards/tracking-rows";

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
    lines: null,
    coverage: { total: 1, repoIds: ["checkout"], points: [] },
    active: true,
    remaining: 5,
    progress: 0.5,
    delta: 2,
    reposAdded: 0,
    ...over,
  };
}

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
