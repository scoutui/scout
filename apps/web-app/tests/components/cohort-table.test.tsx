// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CohortPoint, DashboardScope } from "@scoutui/web-shared";
import { CohortTable } from "@/components/dashboards/cohort-table";

function shareTable(change: number, scope: DashboardScope = { kind: "all" }) {
  const points: CohortPoint[] = [{ cohortKey: "local", label: "Local", color: "", value: 0.5, componentCount: 1 }];
  return render(<CohortTable points={points} change={{ local: change }} scope={scope} colors={new Map()} metric="share" />);
}

describe("CohortTable share change", () => {
  it("reads 0 for a change under 0.05 points", () => {
    shareTable(0.0003);
    expect(screen.getByText("0")).toBeDefined();
    expect(screen.queryByText(/pts/)).toBeNull();
  });

  it("reads signed points for a larger change", () => {
    shareTable(0.142);
    expect(screen.getByText("+14.2 pts")).toBeDefined();
  });
});

describe("CohortTable change title", () => {
  it.each([
    [{ kind: "repo", repoId: "storefront" } as const, "Change since the previous scan"],
    [{ kind: "all" } as const, "Change over the last 30 days"],
  ])("names what the change compares for %o", (scope, title) => {
    shareTable(0.142, scope);
    expect(screen.getByTitle(title)).toBeDefined();
  });
});
