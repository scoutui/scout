// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { PackageSummary } from "@scoutui/web-shared";
import { PackagesTable } from "@/components/packages/packages-table";
import { PackagesExplorer } from "@/components/packages/packages-explorer";

// PackagesExplorer reads its facets from the URL; the mock re-renders on a
// history write, as Next.js does.
vi.mock("next/navigation", async () =>
  (await import("../helpers/search-params-mock")).searchParamsNavigationMock(),
);

const rows: PackageSummary[] = [
  { packageName: "@x/lib",  consumerCount: 3, componentCount: 12, totalOccurrences: 40, deprecatedCount: 0, distinctVersionCount: 2, soleVersion: null },
  { packageName: "@x/wc",   consumerCount: 1, componentCount: 4,  totalOccurrences: 5,  deprecatedCount: 1, distinctVersionCount: 1, soleVersion: "2.1.0" },
  { packageName: "lodash",  consumerCount: 2, componentCount: 1,  totalOccurrences: 20, deprecatedCount: 0, distinctVersionCount: 3, soleVersion: null },
];

describe("PackagesTable", () => {
  it("renders all rows, default sort by Occurrences desc", () => {
    render(<PackagesTable rows={rows} />);
    const renderedNames = screen
      .getAllByRole("row")
      .slice(1) // skip header row
      .map(r => r.textContent ?? "");
    expect(renderedNames[0]).toContain("@x/lib");   // 40 occurrences
    expect(renderedNames[1]).toContain("lodash");    // 20
    expect(renderedNames[2]).toContain("@x/wc");     // 5
  });

  it("shows the version string when a package has exactly one version", () => {
    render(<PackagesTable rows={rows} />);
    // Version column is the 4th data cell (index 3): Package, Repos, Components, Version…
    const xwcRow = screen.getByRole("link", { name: /@x\/wc/ }).closest("tr")!;
    expect(within(xwcRow as HTMLElement).getAllByRole("cell")[3]).toHaveTextContent("2.1.0");
  });

  it("shows a fragmentation count when a package has several versions", () => {
    render(<PackagesTable rows={rows} />);
    const xlibRow = screen.getByRole("link", { name: /@x\/lib/ }).closest("tr")!;
    const lodashRow = screen.getByRole("link", { name: /lodash/ }).closest("tr")!;
    expect(within(xlibRow as HTMLElement).getAllByRole("cell")[3]).toHaveTextContent("2 versions");
    expect(within(lodashRow as HTMLElement).getAllByRole("cell")[3]).toHaveTextContent("3 versions");
  });

  it("renders an em-dash when the package is unversioned (workspace-local)", () => {
    const zeroVersion: PackageSummary[] = [
      { packageName: "@no/versions", consumerCount: 1, componentCount: 2, totalOccurrences: 3, deprecatedCount: 0, distinctVersionCount: 0, soleVersion: null },
    ];
    render(<PackagesTable rows={zeroVersion} />);
    const row = screen.getByRole("link", { name: /@no\/versions/ }).closest("tr")!;
    const versionsCell = within(row as HTMLElement).getAllByRole("cell")[3]!;
    expect(versionsCell).toHaveTextContent("—");
    expect(versionsCell).not.toHaveTextContent("0");
  });

  it("links each package row to /packages/[packageName]", () => {
    render(<PackagesTable rows={rows} />);
    const link = screen.getByRole("link", { name: /@x\/lib/ });
    expect(link).toHaveAttribute("href", "/packages/%40x%2Flib");
  });

  it("carries the deprecated filter into each package's link", () => {
    render(<PackagesTable rows={rows} deprecatedOnly />);
    expect(screen.getByRole("link", { name: /@x\/lib/ })).toHaveAttribute("href", "/packages/%40x%2Flib?deprecated=true");
  });

  it("sorts by Package name when the header is clicked", () => {
    render(<PackagesTable rows={rows} />);
    const pkgHeader = screen.getByRole("button", { name: /^package/i });
    fireEvent.click(pkgHeader); // first click → asc
    const namesAsc = screen.getAllByRole("row").slice(1).map(r => r.textContent ?? "");
    expect(namesAsc[0]).toContain("@x/lib");
    expect(namesAsc[1]).toContain("@x/wc");
    expect(namesAsc[2]).toContain("lodash");
    fireEvent.click(pkgHeader); // second click → desc
    const namesDesc = screen.getAllByRole("row").slice(1).map(r => r.textContent ?? "");
    expect(namesDesc[0]).toContain("lodash");
    expect(namesDesc[2]).toContain("@x/lib");
  });

  it("sorts by Version count when the header is clicked", () => {
    render(<PackagesTable rows={rows} />);
    const header = screen.getByRole("button", { name: /^version/i });
    fireEvent.click(header); // first click → desc (numeric default)
    const names = screen.getAllByRole("row").slice(1).map(r => r.textContent ?? "");
    expect(names[0]).toContain("lodash"); // 3 versions
    expect(names[2]).toContain("@x/wc");   // 1 version
  });

  it("flags deprecated rows with warn styling when count > 0", () => {
    render(<PackagesTable rows={rows} />);
    const xwcRow = screen.getByRole("link", { name: /@x\/wc/ }).closest("tr")!;
    const cells = within(xwcRow as HTMLElement).getAllByRole("cell");
    const depCell = cells[cells.length - 1]!;
    expect(depCell).toHaveTextContent("1");
    expect(within(depCell).getByRole("link").className).toMatch(/text-status-warn-text/);
    const xlibRow = screen.getByRole("link", { name: /@x\/lib/ }).closest("tr")!;
    const xlibCells = within(xlibRow as HTMLElement).getAllByRole("cell");
    const xlibDep = xlibCells[xlibCells.length - 1]!;
    expect(within(xlibDep).getByRole("link").className).not.toMatch(/status-warn|status-err|destructive/);
  });

  it("makes every cell in a row clickable, all pointing at the same href", () => {
    render(<PackagesTable rows={rows} />);
    const row = screen.getByRole("link", { name: /@x\/lib/ }).closest("tr")!;
    const links = within(row as HTMLElement).getAllByRole("link");
    expect(links.length).toBeGreaterThan(1); // not just the package-name cell
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/packages/%40x%2Flib");
    }
  });

  it("counts a single use as `1 use` in the stacked phone row", () => {
    render(<PackagesTable rows={[{ packageName: "@x/wc", consumerCount: 1, componentCount: 1, totalOccurrences: 1, deprecatedCount: 0, distinctVersionCount: 1, soleVersion: "2.1.0" }]} />);
    expect(screen.getByText("1 use")).toBeInTheDocument();
  });
});

describe("PackagesExplorer", () => {
  // jsdom keeps the URL between tests, so an earlier test's URL write would
  // seed the next one.
  beforeEach(() => window.history.replaceState(null, "", "http://localhost:3000/packages"));

  it("filters rows by the search input (substring, case-insensitive)", () => {
    render(<PackagesExplorer rows={rows} canEdit />);
    const input = screen.getByPlaceholderText(/search .* packages by name/i);
    fireEvent.change(input, { target: { value: "WC" } });
    expect(screen.queryByText("@x/lib")).toBeNull();
    expect(screen.getByText("@x/wc")).toBeInTheDocument();
    expect(screen.queryByText("lodash")).toBeNull();
  });

  it("seeds facet state from the URL", () => {
    window.history.replaceState(null, "", "http://localhost:3000/packages?deprecated=true");
    render(<PackagesExplorer rows={rows} canEdit />);
    expect(screen.getByText("@x/wc")).toBeInTheDocument();
    expect(screen.queryByText("@x/lib")).toBeNull();
    expect(screen.queryByText("lodash")).toBeNull();
  });

  it("seeds the versions facet from ?versions=multi", () => {
    window.history.replaceState(null, "", "http://localhost:3000/packages?versions=multi");
    render(<PackagesExplorer rows={rows} canEdit />);
    expect(screen.getByText("@x/lib")).toBeInTheDocument();
    expect(screen.getByText("lodash")).toBeInTheDocument();
    expect(screen.queryByText("@x/wc")).toBeNull();
  });

  it("renders a no-results state with a clear affordance when filters exclude everything", () => {
    render(<PackagesExplorer rows={rows} canEdit />);
    const input = screen.getByPlaceholderText(/search .* packages by name/i);
    fireEvent.change(input, { target: { value: "zzzzz" } });
    expect(screen.getByText(/No packages match/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(screen.getByText("lodash")).toBeInTheDocument();
  });
});

