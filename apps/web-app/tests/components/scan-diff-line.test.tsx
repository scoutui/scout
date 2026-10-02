// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ScanDiff } from "@scoutui/web-shared";
import { ScanDiffLine } from "@/components/repos/scan-diff-line";

// The clause names the gap between the two scans, never the baseline's age, so
// both timestamps are fixed and nothing reads the clock.
const COMMITTED_AT = "2026-09-12T12:00:00.000Z";
const BASELINE_AT = "2026-09-09T12:00:00.000Z"; // 3 days before the shown scan

function diff(o: Partial<ScanDiff>): ScanDiff {
  return { baselineScanId: "S1", baselineCommittedAt: BASELINE_AT, marks: {}, added: 0, removed: 0, changed: 0, removedRows: [], deprecatedPrev: 16, deprecatedNow: 16, ...o };
}

describe("ScanDiffLine", () => {
  it("renders the full sentence, ending with the gap between the scans, as plain text with no link", () => {
    const { container } = render(<ScanDiffLine diff={diff({ added: 3, removed: 8, changed: 18, deprecatedNow: 14 })} committedAt={COMMITTED_AT} />);
    const line = container.firstElementChild as HTMLElement;
    // Real text spaces around every separator, no normalising. The deprecated
    // movement rides with the deprecated alarm, never on this line.
    expect(line.textContent).toBe("3 added · 8 removed · 18 changed since previous scan (3d earlier)");
    expect(line.textContent).not.toContain("deprecated");
    expect(screen.queryByRole("link")).toBeNull();
    // The lucide icon stays out of the accessible name, and no ⇄ glyph is drawn as text.
    expect(line.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(line.textContent).not.toContain("⇄");
  });

  it("the line is two flex children, the icon and one text span, with no underline", () => {
    const { container } = render(<ScanDiffLine diff={diff({ added: 3, removed: 8 })} committedAt={COMMITTED_AT} />);
    const line = container.firstElementChild as HTMLElement;
    expect(line.children).toHaveLength(2);
    const [icon, words] = [...line.children];
    expect(icon?.tagName.toLowerCase()).toBe("svg");
    expect(words?.tagName).toBe("SPAN");
    expect(container.innerHTML).not.toMatch(/underline|decoration-/);
  });

  it("no space in the sentence is a whitespace-only text node beside an inline element (Chrome drops those from the accessible name)", () => {
    const { container } = render(<ScanDiffLine diff={diff({ added: 3, removed: 8, changed: 18 })} committedAt={COMMITTED_AT} />);
    const words = container.firstElementChild?.children[1] as HTMLElement;
    const walker = document.createTreeWalker(words, NodeFilter.SHOW_TEXT);
    const texts: string[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode.textContent ?? "");
    // The only whitespace-only nodes allowed flank the aria-hidden separator dots.
    const bare = texts.filter((t) => t.trim() === "");
    expect(bare).toHaveLength(4); // two separators × a space each side
    expect(texts).toContain(" added");
    expect(texts).toContain(" removed");
    expect(texts).toContain(" changed");
    expect(texts).toContain(" since previous scan ");
    expect(texts).toContain("(");
  });

  it("keeps the parenthetical on one line", () => {
    render(<ScanDiffLine diff={diff({ added: 3 })} committedAt={COMMITTED_AT} />);
    const gap = screen.getByText("3d earlier").parentElement as HTMLElement;
    expect(gap.textContent).toBe("(3d earlier)");
    expect(gap.className).toBe("whitespace-nowrap");
  });

  it("titles the gap with the baseline's absolute time", () => {
    render(<ScanDiffLine diff={diff({ added: 1 })} committedAt={COMMITTED_AT} />);
    expect(screen.getByText("3d earlier")).toHaveAttribute("title", "2026-09-09 12:00 UTC");
  });

  it("measures the gap from the shown scan, not from now", () => {
    // A shown scan a year back still reads its own 2h window.
    const { container } = render(<ScanDiffLine diff={diff({ added: 1, baselineCommittedAt: "2025-01-01T10:00:00.000Z" })} committedAt="2025-01-01T12:30:00.000Z" />);
    expect(container.textContent).toBe("1 added since previous scan (2h earlier)");
  });

  it("two scans under a minute apart read (same time)", () => {
    const { container } = render(<ScanDiffLine diff={diff({ removed: 1, baselineCommittedAt: "2026-09-12T11:59:30.000Z" })} committedAt={COMMITTED_AT} />);
    expect(container.textContent).toBe("1 removed since previous scan (same time)");
  });

  it("omits zero segments", () => {
    const { container } = render(<ScanDiffLine diff={diff({ added: 0, removed: 2, changed: 0 })} committedAt={COMMITTED_AT} />);
    expect(container.textContent).toBe("2 removed since previous scan (3d earlier)");
  });

  it("a deprecated-only movement says no row moved, with no icon", () => {
    const { container } = render(<ScanDiffLine diff={diff({ deprecatedNow: 14 })} committedAt={COMMITTED_AT} />);
    expect(container.textContent).toBe("nothing added, removed or changed since previous scan (3d earlier)");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("first scan: no gap to name", () => {
    render(<ScanDiffLine diff={null} committedAt={COMMITTED_AT} />);
    expect(screen.getByText("first scan · nothing to compare")).toBeInTheDocument();
    expect(screen.queryByText(/earlier/)).toBeNull();
  });

  it("no movement: names the gap", () => {
    const { container } = render(<ScanDiffLine diff={diff({})} committedAt={COMMITTED_AT} />);
    expect(container.textContent).toBe("no change since previous scan (3d earlier)");
  });
});
