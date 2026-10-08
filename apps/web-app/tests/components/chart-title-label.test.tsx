// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ChartTitleLabel } from "@/components/dashboards/chart-title-label";

function renderLabel(text: string) {
  return render(<h1><ChartTitleLabel text={text} /></h1>).container.querySelector("h1")!;
}

describe("ChartTitleLabel", () => {
  it("keeps a scoped package whole, with a line break after its scope for when it alone is wider than the line", () => {
    const h1 = renderLabel("ModalContent · @example/web-modal");
    expect(h1.textContent).toBe("ModalContent · @example/web-modal");
    const wbr = h1.querySelector("wbr");
    expect(wbr?.parentElement?.textContent).toBe("@example/web-modal");
    expect(wbr?.parentElement?.className).toContain("inline-block");
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
