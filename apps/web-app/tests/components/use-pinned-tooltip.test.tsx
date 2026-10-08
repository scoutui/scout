// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { usePinnedTooltip } from "@/components/dashboards/use-pinned-tooltip";

/** A stand-in chart, showing a scan's tooltip cursor unless `cursor` is false. */
function Chart({ cursor = true }: { cursor?: boolean }) {
  const pin = usePinnedTooltip();
  return (
    <>
      <div ref={pin.ref} data-testid="chart" data-pinned={pin.pinned}>
        <div className="recharts-wrapper" onClick={pin.onClick} onKeyDown={pin.onKeyDown}>
          <svg className="recharts-surface" role="application" data-testid="plot">
            <title>Chart</title>
            {cursor ? <line className="recharts-tooltip-cursor" /> : null}
          </svg>
          <div className="recharts-tooltip-wrapper" data-testid="tooltip" />
        </div>
      </div>
      <button type="button">Elsewhere</button>
    </>
  );
}

const pinned = () => screen.getByTestId("chart").getAttribute("data-pinned");

describe("usePinnedTooltip", () => {
  it("pins the tooltip on a click at a scan, and unpins it on a second click", () => {
    render(<Chart />);
    fireEvent.click(screen.getByTestId("plot"));
    expect(pinned()).toBe("true");
    fireEvent.click(screen.getByTestId("plot"));
    expect(pinned()).toBe("false");
  });

  it("doesn't pin on a click where the chart shows no scan", () => {
    render(<Chart cursor={false} />);
    fireEvent.click(screen.getByTestId("plot"));
    expect(pinned()).toBe("false");
  });

  it.each([
    ["Escape", () => fireEvent.keyDown(document.body, { key: "Escape" })],
    ["a press outside the chart", () => fireEvent.pointerDown(screen.getByText("Elsewhere"))],
  ])("unpins on %s", (_, unpin) => {
    render(<Chart />);
    fireEvent.click(screen.getByTestId("plot"));
    unpin();
    expect(pinned()).toBe("false");
  });

  it("stays pinned on a press or click in its tooltip", () => {
    render(<Chart />);
    fireEvent.click(screen.getByTestId("plot"));
    fireEvent.pointerDown(screen.getByTestId("tooltip"));
    fireEvent.click(screen.getByTestId("tooltip"));
    expect(pinned()).toBe("true");
  });

  it("pins on Enter on the plot, at the scan the arrow keys reached", () => {
    render(<Chart />);
    fireEvent.keyDown(screen.getByTestId("plot"), { key: "Enter" });
    expect(pinned()).toBe("true");
  });

  it("doesn't pin on Enter before the arrow keys reach a scan", () => {
    render(<Chart cursor={false} />);
    fireEvent.keyDown(screen.getByTestId("plot"), { key: "Enter" });
    expect(pinned()).toBe("false");
  });
});
