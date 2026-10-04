// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RepoDetail, ScanSummary } from "@scoutui/web-shared";
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

const scans: ScanSummary[] = [
  { scanId: "S1", committedAt: "2026-05-15T12:00:00Z", arrivedAt: "2026-05-15T12:05:00Z", commit: "abcdef1234", branch: "main", uploadedBy: null, ready: true },
  { scanId: "S0", committedAt: "2026-05-13T12:00:00Z", arrivedAt: "2026-05-13T12:05:00Z", commit: "0123456789", branch: "main", uploadedBy: null, ready: true },
];

describe("RepoDetailHeader forge links", () => {
  it("links the remote and the commit on a github remote", () => {
    render(
      <RepoDetailHeader
        detail={makeDetail({ gitRemote: "git@github.com:elk-zone/elk.git" })}
        recentScans={[]}
      />,
    );
    expect(screen.getByRole("link", { name: "github.com/elk-zone/elk" })).toHaveAttribute(
      "href",
      "https://github.com/elk-zone/elk",
    );
    expect(screen.getByRole("link", { name: "abcdef12" })).toHaveAttribute(
      "href",
      "https://github.com/elk-zone/elk/commit/abcdef1234",
    );
  });

  it("links the remote but leaves the commit as plain mono text on an unknown host", () => {
    render(
      <RepoDetailHeader
        detail={makeDetail({ gitRemote: "https://code.example.com/elk-zone/elk.git" })}
        recentScans={[]}
      />,
    );
    expect(screen.getByRole("link", { name: "code.example.com/elk-zone/elk" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "abcdef12" })).toBeNull();
    expect(screen.getByText("abcdef12")).toBeInTheDocument();
  });

  it("says 'no git remote' and keeps the commit plain when there is no remote", () => {
    render(<RepoDetailHeader detail={makeDetail({ gitRemote: null })} recentScans={[]} />);
    expect(screen.getByText("no git remote")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "abcdef12" })).toBeNull();
  });

  it("links each scan's commit in the scan switcher the same way", async () => {
    render(
      <RepoDetailHeader
        detail={makeDetail({ gitRemote: "git@github.com:elk-zone/elk.git", scanCount: 2 })}
        recentScans={scans}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /switch scan/i }));
    expect(await screen.findByRole("link", { name: "0123456" })).toHaveAttribute(
      "href",
      "https://github.com/elk-zone/elk/commit/0123456789",
    );
  });
});

describe("RepoDetailHeader meta line and status row", () => {
  it("keeps the package count and drops the uses total from the meta line", () => {
    render(
      <RepoDetailHeader
        detail={makeDetail({ packageCount: 70, totalOccurrences: 6886 })}
        recentScans={[]}
      />,
    );
    expect(screen.getByText("70 packages")).toBeInTheDocument();
    expect(screen.queryByText(/\buses\b|occurrences/)).toBeNull();
  });

  it("renders the framework split only when more than one framework is present", () => {
    const { rerender } = render(
      <RepoDetailHeader
        detail={makeDetail({ frameworkCounts: [{ kind: "react-component", count: 5 }] })}
        recentScans={[]}
      />,
    );
    expect(screen.queryAllByText(/^react\b/)).toHaveLength(0);
    rerender(
      <RepoDetailHeader
        detail={makeDetail({
          frameworkCounts: [
            { kind: "react-component", count: 5 },
            { kind: "custom-element", count: 2 },
          ],
        })}
        recentScans={[]}
      />,
    );
    expect(screen.queryAllByText(/^react\b/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/^web components\b/).length).toBeGreaterThan(0);
  });
});

describe("RepoDetailHeader without a composition bar", () => {
  it("renders no composition bar for a repo with external and local components", () => {
    const { container } = render(
      <RepoDetailHeader
        detail={makeDetail({ externalComponentCount: 304, localComponentCount: 1575 })}
        recentScans={[]}
      />,
    );
    // Anchor: the header itself rendered, so the absences below can fail.
    expect(screen.getByRole("heading", { level: 1, name: "elk-zone/elk" })).toBeInTheDocument();
    expect(screen.getByText("2 packages")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector(".bg-viz-primary")).toBeNull();
    expect(screen.queryByText(/from packages|tag a library/)).toBeNull();
  });
});

describe("RepoDetailHeader package count", () => {
  it("counts a single package in the singular", () => {
    render(<RepoDetailHeader detail={makeDetail({ packageCount: 1 })} recentScans={[]} />);
    expect(screen.getByText("1 package")).toBeInTheDocument();
  });
});

describe("RepoDetailHeader repo actions", () => {
  it("shows the repo actions menu to someone who can manage repos and to nobody else", () => {
    const { rerender } = render(<RepoDetailHeader detail={makeDetail()} recentScans={[]} canManage />);
    expect(screen.getByRole("button", { name: "Repo actions" })).toBeInTheDocument();
    rerender(<RepoDetailHeader detail={makeDetail()} recentScans={[]} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Repo actions" })).toBeNull();
  });
});
