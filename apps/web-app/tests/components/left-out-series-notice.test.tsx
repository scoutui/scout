// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LeftOutCohort } from "@scoutui/web-shared";
import { LeftOutSeriesNotice } from "@/components/dashboards/left-out-series-notice";

const notIn = (label: string): LeftOutCohort => ({ key: `component:${label}`, kind: "component", label, reason: "elsewhere" });
const gone = (over: Partial<LeftOutCohort> = {}): LeftOutCohort => ({ key: "component:old", kind: "component", label: "Old button", reason: "missing", ...over });
const summaryText = () => document.querySelector("summary")?.textContent;
const lastRow = () => [...document.querySelectorAll("li")].at(-1)?.textContent;

describe("LeftOutSeriesNotice", () => {
  it("counts each reason in its summary, names up to three series per reason, and says how to fix them all once", () => {
    const series = ["App", "Card", "Header", "Footer", "Nav"].map(notIn).concat(gone());
    render(<LeftOutSeriesNotice series={series} repoId="checkout" editHref="/charts/c1/edit" />);
    expect(summaryText()).toBe("6 series are left out·5 not in checkout,1 can't be found");
    expect(screen.getByText("Header")).toBeInTheDocument();
    expect(screen.queryByText("Footer")).toBeNull();
    expect(screen.getByText(/^2 more$/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Edit the chart" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Edit the chart" })).toHaveAttribute("href", "/charts/c1/edit");
    expect(lastRow()).toBe("Edit the chart to pick All repos or another repo, or remove them.");
  });

  it.each([
    ["a named component", gone(), "Old button"],
    ["a deleted tag", gone({ key: "tag:t1", kind: "tag", label: null }), "1 deleted tag"],
    ["an unnamed component", gone({ label: null }), "1 unknown component"],
  ])("names %s that can't be found", (_, series, name) => {
    render(<LeftOutSeriesNotice series={[series]} repoId={null} editHref="/charts/c1/edit" />);
    expect(summaryText()).toBe("1 series is left out·can't be found");
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(lastRow()).toBe("Edit the chart to remove it.");
  });

  it("tells someone who can't change the chart to ask its creator or an Admin", () => {
    render(<LeftOutSeriesNotice series={[notIn("App")]} repoId="checkout" editHref={null} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(lastRow()).toBe("Ask the chart's creator or an Admin to pick All repos or another repo, or remove it.");
  });
});
