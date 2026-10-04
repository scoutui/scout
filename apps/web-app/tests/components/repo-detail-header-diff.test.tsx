// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RepoDetail } from "@scoutui/web-shared";
import { RepoDetailHeader } from "@/components/repos/repo-detail-header";

vi.mock("@/app/repos/repo-actions", () => ({ deleteRepo: vi.fn() }));

function makeDetail(overrides?: Partial<RepoDetail>): RepoDetail {
  return {
    repoId: "elk-zone/elk", gitRemote: null, branch: "main", commit: "abcdef1234",
    committedAt: "2026-05-15T12:00:00Z", scanCount: 1, componentCount: 5,
    externalComponentCount: 3, localComponentCount: 2, packageCount: 2,
    deprecatedCount: 0, totalOccurrences: 9, frameworkCounts: [],
    initialCommit: null, scanId: "S1", arrivedAt: "2026-05-15T12:05:00Z", scannerVersion: "v0",
    delta: null, diff: null, scope: null,
    ...overrides,
  };
}

describe("RepoDetailHeader diff line placement", () => {
  it("sits after the deprecated alarm in the status row", () => {
    const diff = { baselineScanId: "S1", baselineCommittedAt: "2026-05-14T12:00:00Z", marks: {}, added: 3, removed: 0, changed: 0, removedRows: [], deprecatedPrev: 1, deprecatedNow: 1 };
    render(
      <RepoDetailHeader
        detail={makeDetail({ scanCount: 2, scanId: "S2", deprecatedCount: 1, diff })}
        recentScans={[]}
      />,
    );
    const deprecated = screen.getByText("deprecated component in use", { exact: false });
    const diffLine = screen.getByText(/since previous scan/);
    expect(deprecated.compareDocumentPosition(diffLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the first-scan copy from a null diff, even with no alarm in the status row", () => {
    render(<RepoDetailHeader detail={makeDetail()} recentScans={[]} />);
    expect(screen.getByText("first scan · nothing to compare")).toBeInTheDocument();
  });
});

describe("RepoDetailHeader deprecated movement", () => {
  const moved = { baselineScanId: "S1", baselineCommittedAt: "2026-05-12T12:00:00Z", marks: {}, added: 3, removed: 0, changed: 0, removedRows: [], deprecatedPrev: 16, deprecatedNow: 14 };
  // The suffix <span> holds the dot and the sentence; its child span holds the number.
  const exact = (t: string) => (_: string, el: Element | null) => el?.tagName === "SPAN" && el.textContent === t;

  it("rides beside the warn alarm, outside it: `2 fewer` in plain ink, the rest muted", () => {
    render(<RepoDetailHeader detail={makeDetail({ scanCount: 2, scanId: "S2", deprecatedCount: 14, diff: moved })} recentScans={[]} />);
    const alarm = screen.getByText(/deprecated components in use/);
    expect(alarm.className).toMatch(/text-status-warn-text/);
    expect(alarm.className).not.toMatch(/destructive/);
    expect(alarm.textContent).not.toContain("fewer");
    const suffix = screen.getByText(exact("· 2 fewer than the previous scan"));
    expect(alarm.contains(suffix)).toBe(false);
    expect(suffix.className).not.toMatch(/destructive/);
    expect(suffix.className).toMatch(/text-muted-foreground/);
    // Number and word carry the movement together, in medium weight; `than the previous scan` inherits the muted suffix.
    expect(screen.getByText("2 fewer").className).toBe("font-medium tabular-nums text-foreground");
    // Alarm and suffix share one wrapper, so they wrap together.
    expect(suffix.parentElement).toBe(alarm.parentElement);
    // The diff line does not repeat the deprecated count.
    expect(screen.getByText(/since previous scan/).textContent).toBe("3 added since previous scan (3d earlier)");
  });

  it("more, in the retirement polarity's red", () => {
    render(<RepoDetailHeader detail={makeDetail({ scanCount: 2, scanId: "S2", deprecatedCount: 14, diff: { ...moved, deprecatedPrev: 11 } })} recentScans={[]} />);
    expect(screen.getByText(exact("· 3 more than the previous scan"))).toBeInTheDocument();
    expect(screen.getByText("3 more").className).toBe("font-medium tabular-nums text-status-err");
  });

  it("no suffix when the deprecated count did not move", () => {
    render(<RepoDetailHeader detail={makeDetail({ scanCount: 2, scanId: "S2", deprecatedCount: 14, diff: { ...moved, deprecatedPrev: 14 } })} recentScans={[]} />);
    expect(screen.getByText(/deprecated components in use/).textContent).toBe("14deprecated components in use");
    expect(screen.queryByText(/than the previous scan/)).toBeNull();
  });

  it("a finished retirement reads as a muted line with a plain-ink `2 fewer`, no red and no warning glyph", () => {
    const { container } = render(
      <RepoDetailHeader detail={makeDetail({ scanCount: 2, scanId: "S2", deprecatedCount: 0, diff: { ...moved, deprecatedPrev: 2, deprecatedNow: 0 } })} recentScans={[]} />,
    );
    // The icon wrapper and its text span carry the same text; the text span is the innermost (last) match.
    const line = screen.getAllByText(exact("no deprecated components in use · 2 fewer than the previous scan")).at(-1) as HTMLElement;
    expect(container.querySelector(".text-destructive")).toBeNull();
    expect(container.querySelector(".text-status-err")).toBeNull();
    expect(container.querySelector(".text-status-warn-text")).toBeNull();
    expect(screen.getByText("2 fewer").className).toBe("font-medium tabular-nums text-foreground");
    expect(line.parentElement?.className).toMatch(/text-muted-foreground/);
    expect(line.parentElement?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("nothing deprecated now or before: no deprecated line at all", () => {
    render(<RepoDetailHeader detail={makeDetail({ scanCount: 2, scanId: "S2", deprecatedCount: 0, diff: { ...moved, deprecatedPrev: 0, deprecatedNow: 0 } })} recentScans={[]} />);
    expect(screen.queryByText(/deprecated components in use/)).toBeNull();
  });
});

describe("RepoDetailHeader status row", () => {
  it("is plain status text: neither the deprecated alarm nor the diff line links anywhere or carries an underline", () => {
    const moved = { baselineScanId: "S1", baselineCommittedAt: "2026-05-14T12:00:00Z", marks: {}, added: 3, removed: 0, changed: 0, removedRows: [], deprecatedPrev: 16, deprecatedNow: 14 };
    render(<RepoDetailHeader detail={makeDetail({ scanCount: 2, scanId: "S2", deprecatedCount: 14, diff: moved })} recentScans={[]} />);
    const alarm = screen.getByText(/deprecated components in use/);
    const diffLine = screen.getByText(/since previous scan/);
    for (const el of [alarm, diffLine]) {
      expect(el.closest("a")).toBeNull();
      expect(el.closest("[class*='underline']")).toBeNull();
    }
    // The back link stays; nothing else in the header links for this remote-less repo.
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Repos"]);
  });
});
