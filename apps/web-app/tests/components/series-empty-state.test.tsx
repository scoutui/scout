// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeriesEmptyState } from "@/components/dashboards/series-empty-state";

describe("SeriesEmptyState", () => {
  it("draws its example lines in theme colours, so they follow dark mode", () => {
    render(<SeriesEmptyState />);
    const lines = screen.getByRole("img").querySelectorAll("polyline");
    expect([...lines].map((l) => l.getAttribute("stroke"))).toEqual(["var(--viz-legacy)", "var(--viz-primary)"]);
  });
});
