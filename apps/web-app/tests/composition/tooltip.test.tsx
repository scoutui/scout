// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { computeLayout } from "@/components/component-detail/composition/graph-layout";
import { buildEdgeTips } from "@/components/component-detail/composition/graph-highlight";
import { node, graph, model } from "./graph-fixtures";

describe("Tooltip", () => {
  it("opens on focus so keyboard users get the detail line", async () => {
    render(
      <TooltipProvider>
        <Tooltip delay={0}>
          <TooltipTrigger render={<a href="/x">chip</a>} />
          <TooltipContent>detail line</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    fireEvent.focus(screen.getByRole("link", { name: "chip" }));
    expect(await screen.findByText("detail line")).toBeInTheDocument();
  });
});

// Every line the canvas draws is a real render edge, so every line names its
// call-site count. composition-canvas.tsx's edgeTips memo calls buildEdgeTips.
describe("buildEdgeTips", () => {
  const tipsFor = (edges: [string, string, number?][]) => {
    const g = graph([node("F"), node("r0")], edges);
    const m = model(g);
    const layout = computeLayout(m, "F", { pinned: null });
    return buildEdgeTips(layout);
  };

  it("gives a focus-adjacent edge a call-site tooltip", () => {
    const tips = tipsFor([["r0", "F", 12]]);
    expect([...tips.values()].map((t) => t.tip)).toContain("12 call sites render directly.");
  });

  it("uses the singular for exactly one call site", () => {
    const tips = tipsFor([["r0", "F", 1]]);
    expect([...tips.values()].map((t) => t.tip)).toContain("1 call site renders directly.");
  });

  it("never says the word occurrence", () => {
    const tips = tipsFor([["r0", "F", 12]]);
    expect(tips.size).toBeGreaterThan(0);
    for (const { tip } of tips.values()) expect(tip.toLowerCase()).not.toContain("occurrence");
  });

  it("tooltips every drawn edge, including a revealed step that doesn't touch the focus", () => {
    const m = model(graph([node("F"), node("P"), node("G")], [["P", "F", 2], ["G", "P", 3]]));
    const layout = computeLayout(m, "F", { pinned: [{ id: "F", level: 0 }, { id: "P", level: -1 }, { id: "G", level: -2 }] });
    const tips = buildEdgeTips(layout);
    expect(tips.get("G>P")?.tip).toBe("3 call sites render directly.");
    expect(tips.get("P>F")?.tip).toBe("2 call sites render directly.");
  });
});
