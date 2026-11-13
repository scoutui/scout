// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { RepoDetail, ScanFinding, ScanSummary } from "@scoutui/web-shared";
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

const scan = (scanId: string, commit: string, ready = true): ScanSummary => ({
  scanId, committedAt: "2026-05-15T12:00:00Z", arrivedAt: "2026-05-15T12:05:00Z", commit, branch: "main", uploadedBy: null, ready,
});
const scans: ScanSummary[] = [scan("S1", "abcdef1234"), scan("S0", "0123456789")];

async function openScanMenu() {
  fireEvent.click(screen.getByRole("button", { name: /^Scanned/ }));
  return screen.findByRole("dialog");
}

describe("RepoDetailHeader forge links", () => {
  it("links the remote and the commit on a github remote", () => {
    render(<RepoDetailHeader detail={makeDetail({ gitRemote: "git@github.com:elk-zone/elk.git" })} recentScans={[]} />);
    expect(screen.getByRole("link", { name: "github.com/elk-zone/elk" })).toHaveAttribute("href", "https://github.com/elk-zone/elk");
    expect(screen.getByRole("link", { name: "abcdef1" })).toHaveAttribute("href", "https://github.com/elk-zone/elk/commit/abcdef1234");
  });

  it("links the remote but leaves the commit as plain mono text on an unknown host", () => {
    render(<RepoDetailHeader detail={makeDetail({ gitRemote: "https://code.example.com/elk-zone/elk.git" })} recentScans={[]} />);
    expect(screen.getByRole("link", { name: "code.example.com/elk-zone/elk" })).toHaveAttribute("href", "https://code.example.com/elk-zone/elk");
    expect(screen.queryByRole("link", { name: "abcdef1" })).toBeNull();
    expect(screen.getByText("abcdef1")).toBeInTheDocument();
  });

  it("shows no remote and keeps the commit plain when there is no remote", () => {
    render(<RepoDetailHeader detail={makeDetail({ gitRemote: null })} recentScans={[]} />);
    expect(screen.getByText("abcdef1")).toBeInTheDocument();
    expect(screen.getAllByRole("link").map(a => a.textContent)).toEqual(["Repos"]);
  });

  it("links each scan's commit in the scan menu the same way", async () => {
    render(<RepoDetailHeader detail={makeDetail({ gitRemote: "git@github.com:elk-zone/elk.git", scanCount: 2 })} recentScans={scans} />);
    const menu = await openScanMenu();
    expect(within(menu).getByRole("link", { name: "0123456" })).toHaveAttribute("href", "https://github.com/elk-zone/elk/commit/0123456789");
  });
});

describe("RepoDetailHeader scan control", () => {
  // At either end the trigger ends the group, and a hidden spacer outside it keeps the trigger in place.
  const emptySlot = (el: Element | null) => expect(el).toSatisfy((e: Element | null) => e?.tagName === "SPAN" && e.getAttribute("aria-hidden") === "true" && e.classList.contains("invisible"));

  it("steps back to the previous ready scan and offers no step past the latest", () => {
    render(<RepoDetailHeader detail={makeDetail({ scanCount: 3 })} recentScans={[scans[0] as ScanSummary, scan("S9", "999", false), scans[1] as ScanSummary]} />);
    expect(screen.getByRole("link", { name: "Previous scan" })).toHaveAttribute("href", "/repos/elk-zone%2Felk?scan=S0");
    expect(screen.queryByRole("link", { name: "Next scan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next scan" })).toBeNull();
    const trigger = screen.getByRole("button", { name: /^Scanned/ });
    expect(trigger.nextElementSibling).toBeNull();
    emptySlot((trigger.closest("[role=group]") as Element).nextElementSibling);
  });

  it("steps forward from an older scan to the latest's own address and offers no step before the first", () => {
    render(<RepoDetailHeader detail={makeDetail({ scanId: "S0", scanCount: 2 })} recentScans={scans} olderScan />);
    expect(screen.getByRole("link", { name: "Next scan" })).toHaveAttribute("href", "/repos/elk-zone%2Felk");
    expect(screen.queryByRole("link", { name: "Previous scan" })).toBeNull();
    const trigger = screen.getByRole("button", { name: /^Scanned/ });
    expect(trigger.previousElementSibling).toBeNull();
    emptySlot((trigger.closest("[role=group]") as Element).previousElementSibling);
  });

  it("shows the trigger alone, with no steps or spacers, when there's no other ready scan", () => {
    render(<RepoDetailHeader detail={makeDetail()} recentScans={[scans[0] as ScanSummary, scan("S9", "999", false)]} />);
    const group = screen.getByRole("button", { name: /^Scanned/ }).closest("[role=group]") as Element;
    expect(group.children).toHaveLength(1);
    expect(group.previousElementSibling).toBeNull();
    expect(group.nextElementSibling).toBeNull();
  });

  it("lists the scans, marks the latest and the shown one, then the shown scan's details", async () => {
    render(
      <RepoDetailHeader
        detail={makeDetail({
          scanId: "S0", scanCount: 2, packageCount: 70, scannerVersion: "0.14.2",
          frameworkCounts: [{ kind: "react-component", count: 5 }, { kind: "svelte-component", count: 3 }],
        })}
        recentScans={scans}
        olderScan
      />,
    );
    const menu = await openScanMenu();
    const [latest, shown] = within(menu).getAllByRole("listitem");
    expect(latest).toHaveTextContent("· latest");
    expect(within(shown as HTMLElement).getByRole("link", { current: "page" })).toHaveAttribute("href", "/repos/elk-zone%2Felk?scan=S0");
    expect(within(menu).getByRole("link", { name: /All 2 scans/ })).toHaveAttribute("href", "/repos/elk-zone%2Felk/scans");
    const facts = Object.fromEntries(within(menu).getAllByRole("term").map(dt => [dt.textContent, dt.nextElementSibling?.textContent]));
    expect(facts).toEqual({ Scan: "S0", Packages: "70", Frameworks: "React 5Svelte 3", Scanner: "0.14.2" });
  });

  it("names frameworks only when the scan found more than one", async () => {
    render(<RepoDetailHeader detail={makeDetail({ frameworkCounts: [{ kind: "react-component", count: 5 }] })} recentScans={[]} />);
    const menu = await openScanMenu();
    expect(within(menu).getByText("Packages")).toBeInTheDocument();
    expect(within(menu).queryByText("Frameworks")).toBeNull();
  });
});

describe("RepoDetailHeader older scan", () => {
  it("says which scan is shown and links back to the latest only on an older scan", () => {
    const { rerender } = render(<RepoDetailHeader detail={makeDetail({ scanId: "S0" })} recentScans={scans} olderScan />);
    expect(screen.getByRole("complementary", { name: "Older scan notice" })).toHaveTextContent(/^Viewing the scan from .+ ago\. Counts are from that scan\.Back to latest$/);
    expect(screen.getByRole("link", { name: "Back to latest" })).toHaveAttribute("href", "/repos/elk-zone%2Felk");
    rerender(<RepoDetailHeader detail={makeDetail()} recentScans={scans} />);
    expect(screen.queryByRole("complementary", { name: "Older scan notice" })).toBeNull();
  });
});

describe("RepoDetailHeader gaps", () => {
  const findings: ScanFinding[] = [
    { kind: "not-imported", count: 11, examples: [{ text: "VDropdown", count: 8 }], more: 0 },
    { kind: "passed-in", count: 7, examples: [{ text: "Icon", count: 7 }], more: 0 },
  ];

  it("says some uses may be missing, and the button shows one row per kind of gap", () => {
    render(<RepoDetailHeader detail={makeDetail({ findings })} recentScans={[]} />);
    expect(screen.getByText("Some uses may be missing")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "See 2 gaps" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "What this scan couldn't see" })).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("list", { name: "What this scan couldn't see" });
    expect(button).toHaveAttribute("aria-controls", list.id);
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("says nothing about gaps when the scan reported none", () => {
    render(<RepoDetailHeader detail={makeDetail({ findings: [] })} recentScans={[]} />);
    expect(screen.getByRole("heading", { level: 1, name: "elk-zone/elk" })).toBeInTheDocument();
    expect(screen.queryByText("Some uses may be missing")).toBeNull();
    expect(screen.queryByRole("button", { name: /gap/ })).toBeNull();
  });
});

describe("RepoDetailHeader without a composition bar", () => {
  it("renders no composition bar for a repo with external and local components", () => {
    const { container } = render(
      <RepoDetailHeader detail={makeDetail({ externalComponentCount: 304, localComponentCount: 1575 })} recentScans={[]} />,
    );
    // Anchor: the header itself rendered, so the absences below can fail.
    expect(screen.getByRole("heading", { level: 1, name: "elk-zone/elk" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector(".bg-viz-primary")).toBeNull();
    expect(screen.queryByText(/from packages|tag a library/)).toBeNull();
  });
});

describe("RepoDetailHeader settings", () => {
  it("shows a Settings link to someone who can open the repo's settings and to nobody else", () => {
    const { rerender } = render(<RepoDetailHeader detail={makeDetail()} recentScans={[]} canOpenSettings />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/repos/elk-zone%2Felk/settings");
    rerender(<RepoDetailHeader detail={makeDetail()} recentScans={[]} canOpenSettings={false} />);
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });
});
