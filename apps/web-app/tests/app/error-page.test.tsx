// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import RootError from "@/app/error";

describe("RootError", () => {
  it("marks the failure with the error glyph, not the warning triangle", () => {
    const { container } = render(<RootError error={new Error("boom")} reset={vi.fn()} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("lucide-circle-x");
    expect(svg?.getAttribute("class")).toContain("text-status-err");
  });
});
