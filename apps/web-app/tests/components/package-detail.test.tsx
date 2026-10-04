// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// The header hosts QuickTag, whose server actions pull in next-auth, which does
// not resolve under vitest.
vi.mock("@/app/packages/tag-actions", () => ({
  saveTag: vi.fn(async () => ({ ok: true })),
  deleteTag: vi.fn(async () => ({ ok: true })),
  quickTagPackage: vi.fn(async () => ({ ok: true })),
}));

// PackageComponentsTable reads its filters from the URL; the mock re-renders on
// a history write, as Next.js does.
vi.mock("next/navigation", async () =>
  (await import("../helpers/search-params-mock")).searchParamsNavigationMock(),
);
import type { PackageDetail, Tag } from "@scoutui/web-shared";
import { PackageDetailHeader } from "@/components/packages/package-detail-header";
import { PackageConsumersTable } from "@/components/packages/package-consumers-table";
import { PackageComponentsTable } from "@/components/packages/package-components-table";

const baseDetail: PackageDetail = {
  packageName: "@x/lib",
  consumerCount: 2,
  componentCount: 4,
  totalOccurrences: 11,
  deprecatedCount: 1,
  distinctVersionCount: 2,
  soleVersion: null,
  cells: [
    { repoId: "r1", version: "1.2.3", occurrenceCount: 3, committedAt: "2026-05-15T10:00:00Z" },
    { repoId: "r1", version: null, occurrenceCount: 0, committedAt: "2026-05-15T10:00:00Z" },
    { repoId: "r2", version: "2.0.0", occurrenceCount: 8, committedAt: "2026-05-15T11:00:00Z" },
  ],
  components: [
    { componentId: "c1", displayName: "Address", kind: "react-component", totalOccurrences: 8, consumerCount: 2, deprecated: false, usage: "direct" },
    { componentId: "c2", displayName: "Button", kind: "react-component", totalOccurrences: 3, consumerCount: 1, deprecated: true, usage: "direct" },
  ],
};

const coreTag: Tag = { id: "t1", value: "core", category: "library", color: "#0f766e", rule: { glob: [], exact: [] } };

const rowsWithDeadLocal: PackageDetail["components"] = [
  { componentId: "w1", displayName: "FakeButton", kind: "react-component", totalOccurrences: 5, consumerCount: 2, deprecated: false, usage: "direct" },
  { componentId: "c2", displayName: "UnusedComponent", kind: "react-component", totalOccurrences: 4, consumerCount: 1, deprecated: false, usage: "direct" },
  { componentId: "ce1", displayName: "fake-button", kind: "custom-element", totalOccurrences: 3, consumerCount: 1, deprecated: false, usage: "direct" },
  { componentId: "c3", displayName: "DeadLocal", kind: "react-component", totalOccurrences: 0, consumerCount: 0, deprecated: false, usage: "none" },
];

describe("PackageDetailHeader", () => {
  it("renders the package name in monospace", () => {
    render(<PackageDetailHeader detail={baseDetail} canEdit />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("@x/lib");
    expect(heading.className).toMatch(/font-mono/);
  });

  it("renders identity counts in the meta line: repos, components, uses", () => {
    render(<PackageDetailHeader detail={baseDetail} canEdit />);
    expect(screen.getByText(/2 repos/)).toBeInTheDocument();
    expect(screen.getByText(/4 components/)).toBeInTheDocument();
    expect(screen.getByText(/11 uses/)).toBeInTheDocument();
  });

  it("renders the version composition bar, latest first, unversioned last", () => {
    render(<PackageDetailHeader detail={baseDetail} canEdit />);
    const bar = screen.getByRole("img");
    expect(bar).toHaveAttribute(
      "aria-label",
      "Uses by version: 2.0.0 8, 1.2.3 3, unversioned 0",
    );
  });

  it("omits the version bar for unversioned (workspace-local) packages", () => {
    render(
      <PackageDetailHeader
        detail={{
          ...baseDetail,
          distinctVersionCount: 0,
          cells: [{ repoId: "r1", version: null, occurrenceCount: 5, committedAt: "2026-05-15T10:00:00Z" }],
        }}
        canEdit
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders the deprecated count as plain warn-coloured status text when non-zero", () => {
    render(<PackageDetailHeader detail={baseDetail} canEdit />);
    const alarm = screen.getByText(/deprecated component in use/);
    expect(alarm.textContent).toBe("1deprecated component in use");
    expect(alarm.className).toMatch(/text-status-warn-text/);
    expect(alarm.closest("a")).toBeNull();
    expect(alarm.className).not.toMatch(/underline/);
  });

  it("renders no deprecated count when it is zero", () => {
    render(<PackageDetailHeader detail={{ ...baseDetail, deprecatedCount: 0 }} canEdit />);
    expect(screen.queryByText(/deprecated component/)).toBeNull();
  });

  it("shows the tag button to someone who can edit", () => {
    render(<PackageDetailHeader detail={baseDetail} allTags={[coreTag]} canEdit />);
    expect(screen.getByRole("button", { name: "Tag @x/lib" })).toBeInTheDocument();
  });

  it("hides the tag button from someone who can't edit", () => {
    render(<PackageDetailHeader detail={baseDetail} allTags={[coreTag]} canEdit={false} />);
    expect(screen.queryByRole("button", { name: "Tag @x/lib" })).toBeNull();
  });
});

describe("PackageConsumersTable", () => {
  it("renders one row per (repo, version) cell, linking to the repo filtered to the package", () => {
    render(<PackageConsumersTable packageName="@x/lib" cells={baseDetail.cells} />);
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(4); // header + 3 cells
    const r2Link = screen.getAllByRole("link", { name: /r2/ })[0];
    expect(r2Link).toHaveAttribute("href", "/repos/r2?package=@x/lib");
  });

  it("keeps the same table shape for a single consumer (no collapsed summary)", () => {
    render(
      <PackageConsumersTable
        packageName="@x/lib"
        cells={[{ repoId: "r1", version: "1.0.0", occurrenceCount: 42, committedAt: "2026-05-15T00:00:00Z" }]}
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + 1 cell
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
  });

  it("sorts by occurrences desc by default", () => {
    const cells = [
      { repoId: "low", version: "1.0.0", occurrenceCount: 2, committedAt: "2026-05-15T00:00:00Z" },
      { repoId: "high", version: "1.0.0", occurrenceCount: 50, committedAt: "2026-05-15T00:00:00Z" },
      { repoId: "mid", version: "1.0.0", occurrenceCount: 10, committedAt: "2026-05-15T00:00:00Z" },
    ];
    render(<PackageConsumersTable packageName="@x/lib" cells={cells} />);
    const bodyRows = screen.getAllByRole("row").slice(1).map(r => r.textContent ?? "");
    expect(bodyRows[0]).toContain("high");
    expect(bodyRows[1]).toContain("mid");
    expect(bodyRows[2]).toContain("low");
  });

  it("marks only the latest version's rows with the primary dot", () => {
    render(<PackageConsumersTable packageName="@x/lib" cells={baseDetail.cells} />);
    // Latest is 2.0.0 (one cell) → one primary dot; 1.2.3 + unversioned → legacy.
    expect(document.querySelectorAll(".bg-viz-primary")).toHaveLength(1);
    expect(document.querySelectorAll(".bg-viz-legacy")).toHaveLength(2);
  });

  it("renders no dots and an em-dash version for fully unversioned packages", () => {
    render(
      <PackageConsumersTable
        packageName="@x/lib"
        cells={[{ repoId: "r1", version: null, occurrenceCount: 3, committedAt: "2026-05-15T00:00:00Z" }]}
      />,
    );
    expect(document.querySelectorAll(".bg-viz-primary, .bg-viz-legacy")).toHaveLength(0);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders an empty-state when no cells provided", () => {
    render(<PackageConsumersTable packageName="@x/lib" cells={[]} />);
    expect(screen.getByText(/No usage recorded/i)).toBeInTheDocument();
  });
});

describe("PackageComponentsTable", () => {
  // jsdom keeps the URL between tests, so an earlier test's URL write would
  // seed the next one.
  beforeEach(() => window.history.replaceState(null, "", "http://localhost:3000/packages/x"));

  it("renders one row per component with name, kind, consumers, occurrences", () => {
    render(<PackageComponentsTable components={baseDetail.components} />);
    expect(screen.getByText("Address")).toBeInTheDocument();
    expect(screen.getByText("Button")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("marks deprecated rows with the orange warning glyph after the name, never a pill", () => {
    render(<PackageComponentsTable components={baseDetail.components} />);
    // Button (deprecated) carries the glyph, its word read by screen readers and in the hover title…
    const buttonLink = screen.getByRole("link", { name: /Button deprecated/ });
    expect(buttonLink).toHaveAttribute("title", "Button (deprecated)");
    const mark = within(buttonLink).getByText("deprecated").parentElement as HTMLElement;
    expect(mark.className).toBe("inline-flex shrink-0 text-status-warn");
    expect(mark.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(buttonLink.querySelector(".rounded-4xl")).toBeNull();
    // …Address does not.
    expect(screen.getByRole("link", { name: "Address" })).toHaveAttribute("title", "Address");
  });

  it("filters to deprecated rows via the toggle, seeded from ?deprecated=true", () => {
    window.history.replaceState(null, "", "http://localhost:3000/packages/x?deprecated=true");
    render(<PackageComponentsTable components={baseDetail.components} />);
    expect(screen.queryByRole("link", { name: "Address" })).toBeNull();
    expect(screen.getByRole("link", { name: /Button deprecated/ })).toBeInTheDocument();
  });

  it("filters by the name search input", () => {
    render(<PackageComponentsTable components={baseDetail.components} />);
    const input = screen.getByPlaceholderText(/search .* components by name/i);
    fireEvent.change(input, { target: { value: "addr" } });
    expect(screen.getByRole("link", { name: "Address" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Button/ })).toBeNull();
  });

  it("renders an empty-state when no components are provided", () => {
    render(<PackageComponentsTable components={[]} />);
    expect(screen.getByText(/No components observed/i)).toBeInTheDocument();
  });

  it("renders all components in one table, no disclosure", () => {
    render(<PackageComponentsTable components={rowsWithDeadLocal} />);
    expect(screen.queryByRole("button", { name: /supporting/i })).toBeNull();
    // zero-occurrence row visible with an honest 0
    const row = screen.getByText("DeadLocal").closest("tr");
    if (!row) throw new Error("DeadLocal row not found");
    const cells = within(row).getAllByRole("cell");
    // Occurrences column is at index 2 (name, consumers, occurrences)
    expect(cells[2]).toHaveTextContent("0");
  });

  it("never renders scanner vocabulary", () => {
    render(<PackageComponentsTable components={rowsWithDeadLocal} />);
    for (const word of ["supporting", "catalogue", "unreferenced", "entry point", "registered"]) {
      expect(screen.queryByText(new RegExp(word, "i"))).toBeNull();
    }
  });
});
