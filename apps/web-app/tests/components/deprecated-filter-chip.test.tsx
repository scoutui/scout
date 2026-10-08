// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DeprecatedFilterChip } from "@/components/deprecated-filter-chip";

// The pressed state has no `font-medium`, so a toggle never shifts the toolbar.
const BASE =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

describe("DeprecatedFilterChip", () => {
  it("renders the warning glyph, the word and the count, idle and pressed", () => {
    const { rerender } = render(<DeprecatedFilterChip count={1234} active={false} onToggle={vi.fn()} />);
    const idle = screen.getByRole("button");
    expect(idle).toHaveAttribute("aria-pressed", "false");
    expect(idle.textContent).toBe("deprecated1,234");
    expect(idle.className).toBe(`${BASE} border-border text-muted-foreground hover:bg-muted hover:text-foreground`);
    expect(idle.querySelector("svg")?.getAttribute("class")).toContain("size-3.5");
    rerender(<DeprecatedFilterChip count={1234} active onToggle={vi.fn()} />);
    const pressed = screen.getByRole("button");
    expect(pressed).toHaveAttribute("aria-pressed", "true");
    expect(pressed.className).toBe(`${BASE} border-status-warn-border bg-status-warn-tint text-status-warn-text`);
  });

  it("stays in place at zero, disabled while unpressed, so clicking it does nothing", () => {
    const onToggle = vi.fn();
    render(<DeprecatedFilterChip count={0} active={false} onToggle={onToggle} />);
    const chip = screen.getByRole("button");
    expect(chip.textContent).toBe("deprecated0");
    expect(chip).toBeDisabled();
    fireEvent.click(chip);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("reads N of M with a total in one span, padding its end by the digits N is short of the max; N alone without one", () => {
    const { rerender } = render(<DeprecatedFilterChip count={3} total={12} maxCount={14} active={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("button").textContent).toBe("deprecated3 of 12");
    expect(screen.getByText("3 of 12").style.paddingRight).toBe("1ch");
    rerender(<DeprecatedFilterChip count={3} maxCount={14} active={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("button").textContent).toBe("deprecated3");
  });

  it("pads a count narrower than the largest, so a count narrowing from 14 to 7 keeps the chip's width; none padded without a max", () => {
    const { rerender } = render(<DeprecatedFilterChip count={7} maxCount={14} active={false} onToggle={vi.fn()} />);
    expect(screen.getByText("7").style.paddingRight).toBe("1ch");
    rerender(<DeprecatedFilterChip count={1234} maxCount={1234} active={false} onToggle={vi.fn()} />);
    expect(screen.getByText("1,234").style.paddingRight).toBe("0ch");
    rerender(<DeprecatedFilterChip count={7} active={false} onToggle={vi.fn()} />);
    expect(screen.getByText("7").style.paddingRight).toBe("");
  });

  it("stays at zero while pressed, so a filter that leaves it nothing can still be unpressed", () => {
    const onToggle = vi.fn();
    render(<DeprecatedFilterChip count={0} active onToggle={onToggle} />);
    const chip = screen.getByRole("button");
    expect(chip.textContent).toBe("deprecated0");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).not.toBeDisabled();
    chip.click();
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
