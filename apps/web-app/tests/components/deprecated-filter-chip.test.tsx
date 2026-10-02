// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeprecatedFilterChip } from "@/components/deprecated-filter-chip";

// The pressed state has no `font-medium`, so a toggle never shifts the toolbar.
const BASE =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

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

  it("renders nothing at zero", () => {
    render(<DeprecatedFilterChip count={0} active={false} onToggle={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reserves the largest count's width, so a count narrowing from 14 to 7 keeps the chip's width; none reserved without a max", () => {
    const { rerender } = render(<DeprecatedFilterChip count={7} maxCount={14} active={false} onToggle={vi.fn()} />);
    const count = screen.getByText("7");
    expect(count.style.minWidth).toBe("2ch");
    rerender(<DeprecatedFilterChip count={1234} maxCount={1234} active={false} onToggle={vi.fn()} />);
    expect(screen.getByText("1,234").style.minWidth).toBe("5ch");
    rerender(<DeprecatedFilterChip count={7} active={false} onToggle={vi.fn()} />);
    expect(screen.getByText("7").style.minWidth).toBe("");
  });

  it("stays at zero while pressed, so a filter that leaves it nothing can still be unpressed", () => {
    const onToggle = vi.fn();
    render(<DeprecatedFilterChip count={0} active onToggle={onToggle} />);
    const chip = screen.getByRole("button");
    expect(chip.textContent).toBe("deprecated0");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    chip.click();
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
