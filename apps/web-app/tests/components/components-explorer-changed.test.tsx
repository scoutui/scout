// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentRow, ScanDiff } from "@scoutui/web-shared";
import { ComponentsExplorer } from "@/components/repos/components-explorer";

vi.mock("next/navigation", async () =>
  (await import("../helpers/search-params-mock")).searchParamsNavigationMock(),
);

const base: ComponentRow = {
  componentId: "", kind: "react-component", scope: "external", packageName: "@x/lib",
  displayName: "", disambiguator: null, version: "1.0.0", occurrenceCount: 1, fileCount: 1,
  deprecated: false, tags: [],
};
const rows: ComponentRow[] = [
  { ...base, componentId: "same", displayName: "Same", occurrenceCount: 4 },
  { ...base, componentId: "grew", displayName: "Grew", occurrenceCount: 9 },
  { ...base, componentId: "fresh", displayName: "Fresh", occurrenceCount: 2 },
];
const diff: ScanDiff = {
  baselineScanId: "S1",
  baselineCommittedAt: "2026-09-01T00:00:00.000Z",
  marks: { grew: { kind: "changed", delta: 3 }, fresh: { kind: "added" }, gone: { kind: "removed" } },
  added: 1, removed: 1, changed: 1,
  removedRows: [{ componentId: "gone", displayName: "Gone", packageName: "@x/lib", scope: "external", kind: "react-component", occurrenceCount: 6, deprecated: false, tags: [] }],
  deprecatedPrev: 0, deprecatedNow: 0,
};
// The toolbar count <span> holds the whole sentence; its child spans hold the numbers.
const sentence = (t: string) => (_: string, el: Element | null) => el?.tagName === "SPAN" && el.textContent === t;
// A row's desktop Uses cell: the last cell of the row the name sits in.
const occurrencesOf = (name: string) =>
  within(screen.getByText(name).closest("tr") as HTMLElement).getAllByRole("cell").at(-1)?.textContent;
// Anchored: in the changed view the Uses header's name also ends in "since previous scan".
const sinceChip = () => screen.getByRole("button", { name: /^since previous scan/ });
const DELTA_SORT_NAME = "Uses, sorts by change since previous scan";

describe("ComponentsExplorer ?changed=true", () => {
  beforeEach(() => window.history.replaceState(null, "", "http://localhost:3000/repos/r1"));

  it("shows every row and no Δ by default", () => {
    render(<ComponentsExplorer repoId="r1" rows={rows} deprecatedTotal={0} diff={diff} />);
    expect(screen.getByText("Same")).toBeInTheDocument();
    expect(screen.queryByText("Gone")).toBeNull();
    expect(sinceChip()).toHaveAttribute("aria-pressed", "false");
    expect(occurrencesOf("Grew")).toBe("9");
    expect(screen.getByRole("columnheader", { name: "Uses" })).toHaveAttribute("aria-sort", "descending");
  });

  it("narrows to marked rows plus the removed ghosts, with the Δ beside each count, the pressed chip and an honest count", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?changed=true");
    render(<ComponentsExplorer repoId="r1" rows={rows} deprecatedTotal={0} diff={diff} />);
    expect(screen.queryByText("Same")).toBeNull();
    expect(screen.getByText("Grew")).toBeInTheDocument();
    expect(screen.getByText("Fresh")).toBeInTheDocument();
    expect(screen.getByText("Gone")).toBeInTheDocument();
    expect(occurrencesOf("Grew")).toBe("9 (+3)");
    expect(occurrencesOf("Gone")).toBe("0 (−6)");
    expect(screen.getAllByRole("columnheader")).toHaveLength(5);
    expect(screen.getByRole("columnheader", { name: /^Uses/ })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("button", { name: DELTA_SORT_NAME })).toBeInTheDocument();
    // The chip counts every row the view shows: 1 added + 1 changed + 1 removed.
    const chip = sinceChip();
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip.textContent).toBe("since previous scan3");
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull(); // no pill
    // Unfiltered, the toolbar reads the view's size; the breakdown is the masthead's.
    expect(screen.getByText(sentence("3 moved"))).toBeInTheDocument();
    // Un-pressing the chip restores the full table.
    fireEvent.click(chip);
    expect(screen.getByText("Same")).toBeInTheDocument();
    expect(screen.queryByText("Gone")).toBeNull();
  });

  it("ignores ?changed=true when there is no diff (first scan)", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?changed=true");
    render(<ComponentsExplorer repoId="r1" rows={rows} deprecatedTotal={0} diff={null} />);
    expect(screen.getByText("Same")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /since previous scan/ })).toBeNull();
    expect(occurrencesOf("Grew")).toBe("9");
    // Inert, so the toolbar does not read as filtering: the plain total, not "3 of 3".
    expect(screen.queryByText(sentence("3 of 3 components"))).toBeNull();
    expect(screen.getByText(sentence("3 components"))).toBeInTheDocument();
  });

  it("ignores ?changed=true when only the deprecated count moved: every row, no chip, no Δ", () => {
    const deprecatedOnly: ScanDiff = { ...diff, marks: {}, added: 0, removed: 0, changed: 0, removedRows: [], deprecatedPrev: 1, deprecatedNow: 0 };
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?changed=true");
    render(<ComponentsExplorer repoId="r1" rows={rows} deprecatedTotal={0} diff={deprecatedOnly} />);
    for (const name of ["Same", "Grew", "Fresh"]) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /since previous scan/ })).toBeNull();
    expect(occurrencesOf("Grew")).toBe("9");
    expect(screen.getByRole("columnheader", { name: "Uses" })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByText(sentence("3 components"))).toBeInTheDocument();
  });

  it("keeps a tagged ghost under tag:forms and hides an untagged one; chip and toolbar count what the tag leaves, anchored to the whole view", () => {
    // Ghost tags resolve through resolveTags, not copied off a live row: a
    // removed component's package can still carry a tag.
    const forms = { id: "t-forms", value: "forms", category: null, color: "#000" };
    const tagged: ComponentRow[] = [
      { ...base, componentId: "new-forms", displayName: "FormsNew", packageName: "@x/forms", tags: [forms] },
      { ...base, componentId: "new-other", displayName: "OtherNew" },
      { ...base, componentId: "grew-other", displayName: "OtherGrew", occurrenceCount: 5 },
    ];
    const taggedDiff: ScanDiff = {
      baselineScanId: "S1",
      baselineCommittedAt: "2026-09-01T00:00:00.000Z",
      marks: {
        "new-forms": { kind: "added" },
        "new-other": { kind: "added" },
        "grew-other": { kind: "changed", delta: 2 },
        "gone-forms": { kind: "removed" },
        "gone-other": { kind: "removed" },
      },
      added: 2, removed: 2, changed: 1,
      removedRows: [
        { componentId: "gone-forms", displayName: "FormsGhost", packageName: "@x/forms", scope: "external", kind: "react-component", occurrenceCount: 4, deprecated: false, tags: [forms] },
        { componentId: "gone-other", displayName: "OtherGhost", packageName: "@x/lib", scope: "external", kind: "react-component", occurrenceCount: 2, deprecated: false, tags: [] },
      ],
      deprecatedPrev: 0, deprecatedNow: 0,
    };
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?changed=true&tag=forms");
    render(<ComponentsExplorer repoId="r1" rows={tagged} deprecatedTotal={0} diff={taggedDiff} />);
    expect(screen.getByText("FormsGhost")).toBeInTheDocument();
    expect(screen.getByText("FormsNew")).toBeInTheDocument();
    expect(screen.queryByText("OtherGhost")).toBeNull();
    expect(screen.queryByText("OtherNew")).toBeNull();
    // The chip counts under the tag too, agreeing with the toolbar's 2; the toolbar keeps the view's 5 as its anchor.
    expect(sinceChip().textContent).toBe("since previous scan2");
    expect(screen.getByText(sentence("2 of 5 moved · 1 added · 1 removed"))).toBeInTheDocument();
  });

  it("the deprecated chip reads its count alone in the changed view, where removed rows can take it past the status line's count", () => {
    const withDeprecated = rows.map((r) => (r.componentId === "grew" ? { ...r, deprecated: true } : r));
    const deprecatedGhost: ScanDiff = { ...diff, removedRows: diff.removedRows.map((r) => ({ ...r, deprecated: true })) };
    // origin=external keeps every row and is another filter, so only the changed view keeps `of 1` off.
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?changed=true&origin=external");
    render(<ComponentsExplorer repoId="r1" rows={withDeprecated} deprecatedTotal={1} diff={deprecatedGhost} />);
    // Grew and the removed Gone.
    expect(screen.getByRole("button", { name: /^deprecated/ }).textContent).toBe("deprecated2");
  });
});

describe("ComponentsExplorer facet counts follow the other filters", () => {
  beforeEach(() => window.history.replaceState(null, "", "http://localhost:3000/repos/r1"));

  const faceted: ComponentRow[] = [
    { ...base, componentId: "a", displayName: "Alpha", packageName: "@x/lib", deprecated: true, occurrenceCount: 5 },
    { ...base, componentId: "b", displayName: "Beta", scope: "local", packageName: null, deprecated: true, occurrenceCount: 3 },
    { ...base, componentId: "c", displayName: "Gamma", packageName: "@y/ui", occurrenceCount: 8 },
  ];
  const facetedDiff: ScanDiff = {
    baselineScanId: "S1",
    baselineCommittedAt: "2026-09-01T00:00:00.000Z",
    marks: { a: { kind: "changed", delta: 2 }, omega: { kind: "removed" } },
    added: 0, removed: 1, changed: 1,
    removedRows: [{ componentId: "omega", displayName: "Omega", packageName: "@x/old", scope: "external", kind: "react-component", occurrenceCount: 4, deprecated: false, tags: [] }],
    deprecatedPrev: 2, deprecatedNow: 2,
  };
  const menuRow = (value: RegExp) => screen.queryByRole("button", { name: value });
  async function openPackages() {
    fireEvent.click(screen.getByRole("button", { name: /^filter/i }));
    // The table's Package column header is a button too; the menu's is not in a header cell.
    const entries = await screen.findAllByRole("button", { name: /^package/i });
    fireEvent.click(entries.find((b) => b.closest("th") === null) as HTMLElement);
    await screen.findByRole("button", { name: "Back to filters" });
  }

  it("under ?deprecated=true and external, Packages offers only packages with deprecated external components, and both chips count under the same filters", async () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?origin=external&deprecated=true");
    render(<ComponentsExplorer repoId="r1" rows={faceted} deprecatedTotal={2} diff={facetedDiff} />);
    // Deprecated ignores its own filter but keeps external: Alpha (Beta is local), of the repo's 2.
    expect(screen.getByRole("button", { name: /^deprecated/ }).textContent).toBe("deprecated1 of 2");
    // Moved rows under both filters: Alpha; the ghost Omega is not deprecated.
    expect(screen.getByRole("button", { name: /^since previous scan/ }).textContent).toBe("since previous scan1");
    await openPackages();
    expect(menuRow(/^@x\/lib/)?.textContent).toBe("@x/lib1");
    expect(menuRow(/^@y\/ui/)).toBeNull(); // Gamma is not deprecated: 0, hidden
    expect(menuRow(/^@x\/old/)).toBeNull(); // a ghost's package is not in the normal view's rows
  });

  it("in the changed view the base is the view's rows, ghosts included, so a package only a ghost had is offered", async () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?changed=true");
    render(<ComponentsExplorer repoId="r1" rows={faceted} deprecatedTotal={2} diff={facetedDiff} />);
    // Deprecated counts the view's rows: Alpha.
    expect(screen.getByRole("button", { name: /^deprecated/ }).textContent).toBe("deprecated1");
    await openPackages();
    expect(menuRow(/^@x\/old/)?.textContent).toBe("@x/old1");
    expect(menuRow(/^@x\/lib/)?.textContent).toBe("@x/lib1");
    expect(menuRow(/^@y\/ui/)).toBeNull(); // Gamma did not move
  });

  it("a selected package the other filters leave at 0 stays listed, and a pressed chip they empty stays pressed at 0", async () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?package=@y/ui&deprecated=true");
    render(<ComponentsExplorer repoId="r1" rows={faceted} deprecatedTotal={2} diff={facetedDiff} />);
    expect(screen.getByText("No components match these filters.")).toBeInTheDocument();
    const deprecated = screen.getByRole("button", { name: /^deprecated/ });
    expect(deprecated.textContent).toBe("deprecated0 of 2");
    expect(deprecated).toHaveAttribute("aria-pressed", "true");
    await openPackages();
    const picked = menuRow(/^@y\/ui/) as HTMLElement;
    expect(picked.textContent).toBe("@y/ui0");
    expect(picked).toHaveAttribute("aria-pressed", "true");
    expect(menuRow(/^@x\/lib/)?.textContent).toBe("@x/lib1");
  });

  it("leaves a row the latest scan doesn't have unlinked in both views, and says so", () => {
    render(<ComponentsExplorer repoId="r1" rows={rows} notInLatest={["fresh"]} deprecatedTotal={0} diff={diff} />);
    const expectUnlinked = () => {
      const tr = screen.getByText("Fresh").closest("tr") as HTMLElement;
      expect(within(tr).getByText("not in the latest scan")).toBeInTheDocument();
      expect(tr.querySelector("a, button, [tabindex]")).toBeNull();
      expect(screen.getAllByText("not in the latest scan")).toHaveLength(1);
      expect(screen.getByRole("link", { name: "Grew" })).toHaveAttribute("href", "/repos/r1/components/grew");
    };
    expectUnlinked();
    fireEvent.click(sinceChip());
    expectUnlinked();
  });
});
