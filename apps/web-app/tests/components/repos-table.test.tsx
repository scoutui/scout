// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { RepoSummary } from "@scoutui/web-shared";
import { ReposTable } from "@/components/repos/repos-table";
import { ReposExplorer } from "@/components/repos/repos-explorer";

// ReposExplorer reads its search text from the URL; the mock re-renders on a
// history write, as Next.js does.
vi.mock("next/navigation", async () =>
  (await import("../helpers/search-params-mock")).searchParamsNavigationMock(),
);

function repo(overrides: Partial<RepoSummary> & { repoId: string }): RepoSummary {
  return {
    gitRemote: null,
    branch: "main",
    commit: "abcdef1234567890",
    committedAt: "2026-07-18T10:00:00.000Z",
    scanCount: 1,
    componentCount: 0,
    externalComponentCount: 0,
    localComponentCount: 0,
    packageCount: 0,
    deprecatedCount: 0,
    totalOccurrences: 0,
    frameworkCounts: [],
    delta: null,
    ...overrides,
  };
}

const rows: RepoSummary[] = [
  repo({
    repoId: "acme-web",
    gitRemote: "https://github.com/acme/acme-web.git",
    committedAt: "2026-07-18T10:00:00.000Z",
    componentCount: 50,
    externalComponentCount: 40,
    localComponentCount: 10,
    deprecatedCount: 2,
  }),
  repo({
    repoId: "beta-app",
    branch: "develop",
    committedAt: "2026-07-19T10:00:00.000Z",
    componentCount: 5,
    externalComponentCount: 5,
    localComponentCount: 0,
  }),
  repo({
    repoId: "gamma-tool",
    committedAt: "2026-07-01T10:00:00.000Z",
    componentCount: 300,
    externalComponentCount: 100,
    localComponentCount: 200,
  }),
];

describe("ReposTable", () => {
  it("renders all rows, default sort by Committed desc", () => {
    render(<ReposTable rows={rows} />);
    const rendered = screen.getAllByRole("row").slice(1).map(r => r.textContent ?? "");
    expect(rendered[0]).toContain("beta-app");   // most recent
    expect(rendered[1]).toContain("acme-web");
    expect(rendered[2]).toContain("gamma-tool");
  });

  it("shows the component count as a plain size cue, no origin split", () => {
    render(<ReposTable rows={rows} />);
    const row = screen.getByRole("link", { name: "acme-web" }).closest("tr")!;
    const componentsCell = within(row as HTMLElement).getAllByRole("cell")[2]!;
    expect(componentsCell).toHaveTextContent("50");
    expect(row).not.toHaveTextContent(/external|local/);
  });

  it("sorts by component count when the Components header is clicked", () => {
    render(<ReposTable rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: /^components/i }));
    const rendered = screen.getAllByRole("row").slice(1).map(r => r.textContent ?? "");
    expect(rendered[0]).toContain("gamma-tool"); // 300
    expect(rendered[1]).toContain("acme-web");   // 50
    expect(rendered[2]).toContain("beta-app");   // 5
  });

  it("puts aria-sort on the active column header, not the button", () => {
    render(<ReposTable rows={rows} />);
    const committed = screen.getByRole("columnheader", { name: /committed/i });
    expect(committed).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: /^repo/i })).toHaveAttribute("aria-sort", "none");
    expect(screen.getByRole("button", { name: /committed/i })).not.toHaveAttribute("aria-sort");
  });

  it("flags deprecated rows with warn styling and mutes zero to a dash", () => {
    render(<ReposTable rows={rows} />);
    const acmeRow = screen.getByRole("link", { name: "acme-web" }).closest("tr")!;
    const acmeCells = within(acmeRow as HTMLElement).getAllByRole("cell");
    // Deprecated is second to last: the Changes column follows it.
    const acmeDep = acmeCells[acmeCells.length - 2]!;
    expect(acmeDep).toHaveTextContent("2");
    expect(acmeDep.className).toMatch(/text-status-warn-text/);
    const betaRow = screen.getByRole("link", { name: "beta-app" }).closest("tr")!;
    const betaCells = within(betaRow as HTMLElement).getAllByRole("cell");
    const betaDep = betaCells[betaCells.length - 2]!;
    expect(betaDep).toHaveTextContent("—");
    expect(betaDep.className).not.toMatch(/status-warn|status-err|destructive/);
  });

  it("has exactly one link per row, named by the repo id, to the detail page", () => {
    render(<ReposTable rows={rows} />);
    const row = screen.getByRole("link", { name: "acme-web" }).closest("tr")!;
    const links = within(row as HTMLElement).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/repos/acme-web");
    // The remote belongs in the repo page's masthead, not as a second link here.
    expect(screen.queryByRole("link", { name: "github.com/acme/acme-web" })).toBeNull();
  });

  it("shows branch and short commit as scan provenance, never the scan count", () => {
    render(<ReposTable rows={[repo({ repoId: "many", scanCount: 54, branch: "develop" })]} />);
    const row = screen.getByRole("link", { name: "many" }).closest("tr")!;
    expect(row).toHaveTextContent("develop");
    expect(row).toHaveTextContent("abcdef1");
    expect(row).not.toHaveTextContent(/scans/);
  });
});

describe("ReposExplorer", () => {
  // jsdom keeps the URL between tests, so an earlier test's URL write would
  // seed the next one.
  beforeEach(() => window.history.replaceState(null, "", "http://localhost:3000/repos"));

  it.each([
    [rows.slice(0, 1), "Search 1 repo…"],
    [rows, "Search 3 repos…"],
  ])("counts the repos in the search box's placeholder", (given, placeholder) => {
    render(<ReposExplorer rows={given} />);
    expect(screen.getByPlaceholderText(placeholder)).toBeInTheDocument();
  });

  it("filters rows by repo id (substring, case-insensitive)", () => {
    render(<ReposExplorer rows={rows} />);
    fireEvent.change(screen.getByPlaceholderText(/search .* repos/i), { target: { value: "ACME" } });
    expect(screen.getByText("acme-web")).toBeInTheDocument();
    expect(screen.queryByText("beta-app")).toBeNull();
    expect(screen.queryByText("gamma-tool")).toBeNull();
  });

  it("filters rows by branch", () => {
    render(<ReposExplorer rows={rows} />);
    fireEvent.change(screen.getByPlaceholderText(/search .* repos/i), { target: { value: "develop" } });
    expect(screen.getByText("beta-app")).toBeInTheDocument();
    expect(screen.queryByText("acme-web")).toBeNull();
  });

  it("seeds the search from ?q= in the URL", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos?q=gamma");
    render(<ReposExplorer rows={rows} />);
    expect(screen.getByText("gamma-tool")).toBeInTheDocument();
    expect(screen.queryByText("acme-web")).toBeNull();
  });

  it("renders a no-results state with a clear affordance", () => {
    render(<ReposExplorer rows={rows} />);
    fireEvent.change(screen.getByPlaceholderText(/search .* repos/i), { target: { value: "zzzzz" } });
    expect(screen.getByText(/No repos match/i)).toBeInTheDocument();
    // Two controls share the "Clear search" name (input X + empty-state button);
    // both clear, click the empty-state one.
    fireEvent.click(screen.getAllByRole("button", { name: /clear search/i }).at(-1)!);
    expect(screen.getByText("gamma-tool")).toBeInTheDocument();
  });
});

describe("ReposTable: Changes", () => {
  const moved = [
    repo({ repoId: "big-move", scanCount: 3, deprecatedCount: 14, delta: { added: 3, removed: 16, changed: 18, deprecated: -2 } }),
    repo({ repoId: "small-move", scanCount: 2, delta: { added: 0, removed: 2, changed: 0, deprecated: 0 } }),
    repo({ repoId: "still", scanCount: 2, delta: { added: 0, removed: 0, changed: 0, deprecated: 0 } }),
    repo({ repoId: "first", scanCount: 1, delta: null }),
  ];
  const rowOf = (name: string) => screen.getByRole("link", { name }).closest("tr") as HTMLElement;
  const lastCell = (tr: HTMLElement) => within(tr).getAllByRole("cell").at(-1) as HTMLElement;
  // The Changes cell renders both forms; CSS shows words from lg, the compact form below it.
  const wordsOf = (name: string) => lastCell(rowOf(name)).querySelector(".lg\\:inline") as HTMLElement;
  const compactOf = (name: string) => lastCell(rowOf(name)).querySelector(".lg\\:hidden") as HTMLElement;
  const HEADER_NAME = "Changes: added, removed or changed since the previous scan";

  it("from lg reads in words, `+3 added · −16 removed · 18 changed`, zero parts omitted, numbers ink and words muted", () => {
    const changedOnly = repo({ repoId: "changed-only", scanCount: 2, delta: { added: 0, removed: 0, changed: 18, deprecated: 0 } });
    render(<ReposTable rows={[...moved, changedOnly]} />);
    const big = wordsOf("big-move");
    expect(big.textContent).toBe("+3 added · −16 removed · 18 changed");
    expect(big.className).toBe("hidden text-muted-foreground lg:inline");
    for (const n of ["+3", "−16", "18"]) expect(within(big).getByText(n).className).toBe("font-medium text-foreground");
    expect(wordsOf("small-move").textContent).toBe("−2 removed");
    expect(wordsOf("changed-only").textContent).toBe("18 changed");
  });

  it("below lg keeps the compact `+3 −16 · 18 changed`, the header's title spelling out what it counts; a dash when unmoved, visible first-scan text", () => {
    const changedOnly = repo({ repoId: "changed-only", scanCount: 2, delta: { added: 0, removed: 0, changed: 18, deprecated: 0 } });
    render(<ReposTable rows={[...moved, changedOnly]} />);
    const sort = screen.getByRole("button", { name: HEADER_NAME });
    expect(sort).toHaveAttribute("title", HEADER_NAME);
    expect(sort.textContent).toBe("Changes");
    const big = compactOf("big-move");
    expect(big.textContent).toBe("+3 −16 · 18 changed");
    // The counts are ink medium; the word `changed` is muted.
    expect(within(big).getByText("+3 −16").className).toMatch(/font-medium.*text-foreground|text-foreground.*font-medium/);
    expect(within(big).getByText("18").className).toMatch(/font-medium/);
    expect(within(big).getByText("18").parentElement?.className).toMatch(/text-muted-foreground/);
    expect(compactOf("small-move").textContent).toBe("−2");
    expect(compactOf("changed-only").textContent).toBe("18 changed");
    expect(lastCell(rowOf("still")).textContent).toBe("—");
    const first = lastCell(rowOf("first"));
    expect(first.textContent).toBe("first scan");
    expect(within(first).getByText("first scan").className).toMatch(/text-faint/);
  });

  it("shows the deprecated Δ in brackets beside the orange count, `14 (−2)`: only the number takes the retirement polarity", () => {
    const grew = repo({ repoId: "dep-grew", scanCount: 2, deprecatedCount: 5, delta: { added: 0, removed: 0, changed: 0, deprecated: 2 } });
    render(<ReposTable rows={[...moved, grew]} />);
    const depCell = (name: string) => {
      const cells = within(rowOf(name)).getAllByRole("cell");
      return cells[cells.length - 2] as HTMLElement;
    };
    expect(depCell("big-move").textContent).toBe("14 (−2)");
    expect(depCell("big-move").className).toMatch(/font-medium text-status-warn-text/);
    const fewer = within(depCell("big-move")).getByText("−2");
    expect(fewer.className).toBe("font-medium text-foreground");
    // The brackets and the space are muted, separating the number from the orange count.
    expect(fewer.parentElement?.className).toBe("font-normal text-muted-foreground");
    expect(depCell("dep-grew").textContent).toBe("5 (+2)");
    expect(within(depCell("dep-grew")).getByText("+2").className).toBe("font-medium text-status-err");
  });

  it("a finished retirement reads as a number beside its Δ; an unmoved zero keeps the dash", () => {
    const retired = repo({ repoId: "retired", scanCount: 2, deprecatedCount: 0, delta: { added: 0, removed: 0, changed: 0, deprecated: -2 } });
    render(<ReposTable rows={[retired, moved[2] as RepoSummary]} />);
    const retiredCells = within(rowOf("retired")).getAllByRole("cell");
    expect(retiredCells[retiredCells.length - 2]?.textContent).toBe("0 (−2)");
    const stillCells = within(rowOf("still")).getAllByRole("cell");
    expect(stillCells[stillCells.length - 2]?.textContent).toBe("—");
  });

  it("sorts by added + removed + changed + |deprecated Δ| descending, first scans last", () => {
    const depOnly = repo({ repoId: "dep-move", scanCount: 2, delta: { added: 0, removed: 0, changed: 0, deprecated: -5 } });
    const changedOnly = repo({ repoId: "changed-move", scanCount: 2, delta: { added: 0, removed: 0, changed: 4, deprecated: 0 } });
    render(<ReposTable rows={[...moved, depOnly, changedOnly]} />);
    fireEvent.click(screen.getByRole("button", { name: HEADER_NAME }));
    const order = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(order[0]).toContain("big-move");     // 3 + 16 + 18 + 2 = 39
    expect(order[1]).toContain("dep-move");     // |−5|: only the deprecated term ranks it
    expect(order[2]).toContain("changed-move"); // 4: only the changed term ranks it
    expect(order[3]).toContain("small-move");   // 2
    expect(order[4]).toContain("still");        // 0
    expect(order[5]).toContain("first");        // null → last
  });

  it("mobile tier carries one line: +added −removed · N changed · deprecated (Δ), only the deprecated number toned", () => {
    const grew = repo({ repoId: "dep-grew", scanCount: 2, delta: { added: 1, removed: 0, changed: 0, deprecated: 2 } });
    render(<ReposTable rows={[moved[0] as RepoSummary, grew]} />);
    const line = (t: string) => (_: string, el: Element | null) => el?.tagName === "SPAN" && el.textContent === t;
    const big = within(rowOf("big-move")).getByText(line("+3 −16 · 18 changed · deprecated (−2)"));
    expect(big.className).toBe("text-xs font-medium tabular-nums text-foreground");
    expect(within(big).getByText("−2").className).toBe("text-foreground");
    const up = within(rowOf("dep-grew")).getByText(line("+1 · deprecated (+2)"));
    expect(within(up).getByText("+2").className).toBe("text-status-err");
  });

  it("mobile tier omits a null movement part on a deprecated-only move", () => {
    const deprecatedOnly = repo({ repoId: "dep-only", scanCount: 2, delta: { added: 0, removed: 0, changed: 0, deprecated: -2 } });
    render(<ReposTable rows={[deprecatedOnly]} />);
    // Scoped to the mobile-tier movement span: the desktop Changes cell
    // renders "—" for this row's zero added and removed.
    const line = (t: string) => (_: string, el: Element | null) => el?.tagName === "SPAN" && el.textContent === t;
    const mobileMovement = within(rowOf("dep-only")).getByText(line("deprecated (−2)"));
    expect(mobileMovement.className).toBe("text-xs font-medium tabular-nums text-foreground");
    expect(mobileMovement.textContent).not.toContain("—");
  });
});

describe("ReposExplorer: since previous scan chip", () => {
  const mixed = [
    repo({ repoId: "moved-a", delta: { added: 1, removed: 0, changed: 0, deprecated: 0 } }),
    repo({ repoId: "moved-b", delta: { added: 0, removed: 0, changed: 0, deprecated: -1 } }),
    repo({ repoId: "quiet", delta: { added: 0, removed: 0, changed: 0, deprecated: 0 } }),
    repo({ repoId: "changed-only", delta: { added: 0, removed: 0, changed: 18, deprecated: 0 } }),
  ];
  const chip = () => screen.getByRole("button", { name: /^since previous scan/ });
  // The narrowed-count <span> holds "N of M"; its child span holds N.
  const count = (t: string) => (_: string, el: Element | null) => el?.tagName === "SPAN" && el.textContent === t;
  beforeEach(() => window.history.replaceState(null, "", "http://localhost:3000/repos"));

  it("counts the repos that moved, a changed-only repo included; pressing narrows to them, pressing again restores", () => {
    render(<ReposExplorer rows={mixed} />);
    expect(chip()).toHaveAttribute("aria-pressed", "false");
    expect(chip().textContent).toBe("since previous scan3");
    expect(screen.getByText("quiet")).toBeInTheDocument();
    fireEvent.click(chip());
    expect(chip()).toHaveAttribute("aria-pressed", "true");
    expect(chip().className).not.toMatch(/destructive/);
    expect(screen.queryByText("quiet")).toBeNull();
    expect(screen.getByText("moved-a")).toBeInTheDocument();
    expect(screen.getByText("moved-b")).toBeInTheDocument();
    const changedOnly = screen.getByRole("link", { name: "changed-only" }).closest("tr") as HTMLElement;
    expect(within(changedOnly).getAllByRole("cell").at(-1)?.querySelector(".lg\\:inline")?.textContent).toBe("18 changed");
    expect(screen.getByText(count("3 of 4"))).toBeInTheDocument();
    expect(window.location.search).toBe("?changed=true");
    fireEvent.click(chip());
    expect(screen.getByText("quiet")).toBeInTheDocument();
    // The chip is the only control: no filter-link, no "all repos" link.
    expect(screen.queryByRole("link", { name: /changed since|all \d+ repos/ })).toBeNull();
  });

  it("renders no chip when no repo moved, and a pasted ?changed=true narrows nothing", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos?changed=true");
    render(<ReposExplorer rows={[mixed[2] as RepoSummary]} />); // quiet
    expect(screen.queryByRole("button", { name: /^since previous scan/ })).toBeNull();
    expect(screen.getByText("quiet")).toBeInTheDocument();
  });

  it("?changed=true arrives pressed; text search narrows on top and keeps it", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos?changed=true");
    render(<ReposExplorer rows={mixed} />);
    expect(chip()).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("quiet")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/search .* repos/i), { target: { value: "moved-b" } });
    expect(screen.queryByText("moved-a")).toBeNull();
    expect(screen.getByText("moved-b")).toBeInTheDocument();
    expect(window.location.search).toBe("?q=moved-b&changed=true");
  });
});
