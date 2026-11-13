// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RepoDetail } from "@scoutui/web-shared";
import { RepoDetailHeader } from "@/components/repos/repo-detail-header";

function makeDetail(overrides?: Partial<RepoDetail>): RepoDetail {
  return {
    repoId: "elk-zone/elk", gitRemote: null, branch: "main", commit: "abcdef1234",
    committedAt: "2026-05-15T12:00:00Z", scanCount: 1, componentCount: 5,
    externalComponentCount: 3, localComponentCount: 2, packageCount: 2,
    deprecatedCount: 0, totalOccurrences: 9, frameworkCounts: [],
    initialCommit: null, scanId: "S1", arrivedAt: "2026-05-15T12:05:00Z", scannerVersion: "v0",
    delta: null, diff: null, scope: null, findings: [],
    ...overrides,
  };
}

const moved = (deprecated: number) => ({ added: 0, removed: 0, changed: 4, deprecated });

describe("RepoDetailHeader status line", () => {
  it("reads commit, branch, deprecated count, then what changed", () => {
    render(<RepoDetailHeader detail={makeDetail({ scanCount: 2, deprecatedCount: 1, delta: moved(0) })} recentScans={[]} />);
    const order = ["abcdef1", "main", "deprecated in use", "since previous scan"].map(t => screen.getByText(t, { exact: false }));
    for (let i = 1; i < order.length; i++) {
      expect((order[i - 1] as Element).compareDocumentPosition(order[i] as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("reads a first scan from a null delta, even with no deprecated count", () => {
    render(<RepoDetailHeader detail={makeDetail()} recentScans={[]} />);
    expect(screen.getByText("First scan, nothing to compare")).toBeInTheDocument();
  });

  it("is plain status text: nothing but the back link links anywhere for a repo without a remote", () => {
    render(<RepoDetailHeader detail={makeDetail({ scanCount: 2, deprecatedCount: 14, delta: moved(-2) })} recentScans={[]} />);
    expect(screen.getAllByRole("link").map(a => a.textContent)).toEqual(["Repos"]);
  });
});

describe("RepoDetailHeader deprecated count", () => {
  // Nested spans can share a text; the innermost (last) match is the one that styles it.
  const exact = (t: string) => screen.getAllByText((_, el) => el?.tagName === "SPAN" && el.textContent === t).at(-1) as HTMLElement;

  it("in warning colour, with fewer than the previous scan in plain ink", () => {
    render(<RepoDetailHeader detail={makeDetail({ scanCount: 2, deprecatedCount: 14, delta: moved(-2) })} recentScans={[]} />);
    expect(exact("14 deprecated in use").className).toMatch(/text-status-warn-text/);
    expect(exact("14 deprecated in use (−2 since previous scan)")).toBeInTheDocument();
    expect(screen.getByText("−2").className).toBe("font-medium tabular-nums text-foreground");
  });

  it("more than the previous scan in the retirement polarity's red", () => {
    render(<RepoDetailHeader detail={makeDetail({ scanCount: 2, deprecatedCount: 14, delta: moved(3) })} recentScans={[]} />);
    expect(screen.getByText("+3").className).toBe("font-medium tabular-nums text-status-err");
  });

  it("no movement when the count did not move", () => {
    render(<RepoDetailHeader detail={makeDetail({ scanCount: 2, deprecatedCount: 14, delta: moved(0) })} recentScans={[]} />);
    expect(exact("14 deprecated in use")).toBeInTheDocument();
    expect(screen.queryByText(/\(/)).toBeNull();
  });

  it("a finished retirement keeps the movement without the warning", () => {
    const { container } = render(<RepoDetailHeader detail={makeDetail({ scanCount: 2, deprecatedCount: 0, delta: moved(-2) })} recentScans={[]} />);
    expect(exact("None deprecated in use (−2 since previous scan)")).toBeInTheDocument();
    expect(container.querySelector(".text-status-warn-text, .text-status-warn, .text-status-err")).toBeNull();
  });

  it("nothing deprecated now or before: no deprecated item at all", () => {
    render(<RepoDetailHeader detail={makeDetail({ scanCount: 2, deprecatedCount: 0, delta: moved(0) })} recentScans={[]} />);
    expect(screen.getByText(/since previous scan/)).toBeInTheDocument();
    expect(screen.queryByText(/deprecated in use/)).toBeNull();
  });
});
