// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CohortPoint, CohortSeries } from "@scoutui/web-shared";
import { CohortTable } from "@/components/dashboards/cohort-table";

function shareTable(previous: number, latest: number) {
  const points: CohortPoint[] = [{ cohortKey: "local", label: "Local", color: "", value: latest, componentCount: 1 }];
  const series: CohortSeries[] = [
    { cohortKey: "local", label: "Local", color: "", points: [{ t: "2026-09-01T00:00:00Z", value: previous }, { t: "2026-09-02T00:00:00Z", value: latest }] },
  ];
  return render(<CohortTable points={points} series={series} metric="share" />);
}

describe("CohortTable share change", () => {
  it("reads 0 for a change under 0.05 points", () => {
    shareTable(0.5, 0.5003);
    expect(screen.getByText("0")).toBeDefined();
    expect(screen.queryByText(/pts/)).toBeNull();
  });

  it("reads signed points for a larger change", () => {
    shareTable(0.4, 0.542);
    expect(screen.getByText("+14.2 pts")).toBeDefined();
  });
});
