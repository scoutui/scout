// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ChartTitleLabel } from "@/components/dashboards/chart-title-label";

function renderLabel(text: string) {
  return render(<h1><ChartTitleLabel text={text} /></h1>).container.querySelector("h1")!;
}

describe("ChartTitleLabel", () => {
  it("offers a line break after a scoped package's scope and keeps the rest of the name whole", () => {
    const h1 = renderLabel("ModalContent · @example/web-modal");
    expect(h1.textContent).toBe("ModalContent · @example/web-modal");
    const wbr = h1.querySelector("wbr");
    expect(wbr?.previousSibling?.textContent).toBe("@example/");
    expect(wbr?.nextSibling?.textContent).toBe("web-modal");
    expect((wbr?.nextSibling as HTMLElement).className).toContain("inline-block");
  });

  it("offers no extra break in an unscoped name", () => {
    const h1 = renderLabel("web-modal");
    expect(h1.textContent).toBe("web-modal");
    expect(h1.querySelector("wbr")).toBeNull();
  });
});
