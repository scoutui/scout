// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CohortSwatch } from "@/components/dashboards/cohort-swatch";

describe("CohortSwatch", () => {
  it("a deprecated-role series keys with the warning triangle in the series colour, not a filled square", () => {
    const props = { cohortKey: "component:c1", color: "#e07a10", role: "deprecated" as const };
    const { container } = render(<CohortSwatch {...props} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect((svg as SVGElement).style.color).toBe("rgb(224, 122, 16)");
    expect(container.querySelector("span:not(.sr-only)")).toBeNull();
    expect(container.textContent).toBe("deprecated");
  });

  it("every other role keeps the square dot / tag pill", () => {
    const props = { cohortKey: "package:@x/next", color: "#009598", role: "successor" as const };
    const { container } = render(<CohortSwatch {...props} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("span")?.className).toContain("rounded-[3px]");
    const tag = render(<CohortSwatch cohortKey="tag:web" color="#7c3aed" />).container;
    expect(tag.querySelector("span")?.className).toContain("rounded-full");
  });
});
