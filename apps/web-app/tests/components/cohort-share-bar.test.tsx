// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CohortShareBar } from "@/components/dashboards/cohort-share-bar";

const points = [
  { cohortKey: "component:dead", label: "OldButton · old-ds", color: "#e11", value: 0 },
  { cohortKey: "component:live", label: "new-ds/Button", color: "#0aa", value: 10 },
];

describe("CohortShareBar zero-share cohorts", () => {
  it("renders no bar segment for an exact-zero cohort", () => {
    render(<CohortShareBar points={points} />);
    const bar = screen.getByRole("img");
    expect(bar.querySelectorAll("span")).toHaveLength(1); // only the non-zero segment
  });

  it("still lists the zero cohort in the decode row at 0%", () => {
    render(<CohortShareBar points={points} />);
    // The decode row renders the split grammar (name + muted attribution);
    // the full label lives on the entry's title.
    expect(screen.getByTitle("OldButton · old-ds")).toBeDefined();
    expect(screen.getByText("OldButton")).toBeDefined();
    expect(screen.getByText("old-ds")).toBeDefined();
    expect(screen.getByText("0%")).toBeDefined();
  });
});
