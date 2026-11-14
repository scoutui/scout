// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentRow, ScanDiff } from "@scoutui/web-shared";
import { ComponentsExplorer } from "@/components/repos/components-explorer";
import type { ComponentPanelFacts } from "@/lib/component-panel";
import { packageFilterHref } from "@/lib/component-facets";
import type { SourceRef } from "@/lib/source-link";

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
const cellOf = (name: string, index: number) =>
  within(screen.getByText(name).closest("tr") as HTMLElement).getAllByRole("cell").at(index)?.textContent;
// A row's desktop Uses cell, and its Change cell when the table has one.
const occurrencesOf = (name: string) => cellOf(name, 4);
const changeOf = (name: string) => cellOf(name, 5);
// Anchored: the Change header's name also ends in "since previous scan".
const sinceChip = () => screen.getByRole("button", { name: /^since previous scan/ });

describe("ComponentsExplorer ?changed=true", () => {
  beforeEach(() => window.history.replaceState(null, "", "http://localhost:3000/repos/r1"));

  it("shows every row by default, most used first, with no Change column and no Added badge", () => {
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={rows} deprecatedTotal={0} diff={diff} packages={[]} canEdit />);
    expect(screen.getByText("Same")).toBeInTheDocument();
    expect(screen.queryByText("Gone")).toBeNull();
    expect(sinceChip()).toHaveAttribute("aria-pressed", "false");
    expect(occurrencesOf("Grew")).toBe("9");
    expect(screen.getAllByRole("columnheader")).toHaveLength(5);
    expect(screen.queryByText("Added")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Uses" })).toHaveAttribute("aria-sort", "descending");
  });

  it("narrows to marked rows plus the removed ghosts, with the Δ beside each count, the pressed chip and an honest count", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?changed=true");
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={rows} deprecatedTotal={0} diff={diff} packages={[]} canEdit />);
    expect(screen.queryByText("Same")).toBeNull();
    expect(screen.getByText("Grew")).toBeInTheDocument();
    expect(screen.getByText("Fresh")).toBeInTheDocument();
    expect(screen.getByText("Gone")).toBeInTheDocument();
    expect([occurrencesOf("Grew"), changeOf("Grew")]).toEqual(["9", "+3"]);
    expect([occurrencesOf("Gone"), changeOf("Gone")]).toEqual(["0", "−6"]);
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    expect(screen.getByRole("columnheader", { name: /^Change/ })).toHaveAttribute("aria-sort", "ascending");
    // The chip counts every row the view shows: 1 added + 1 changed + 1 removed.
    const chip = sinceChip();
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip.textContent).toBe("since previous scan3");
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull(); // no pill
    // Unfiltered, the toolbar reads the view's size; the breakdown is the masthead's.
    expect(screen.getByText(sentence("3 changes"))).toBeInTheDocument();
    // Un-pressing the chip restores the full table.
    fireEvent.click(chip);
    expect(screen.getByText("Same")).toBeInTheDocument();
    expect(screen.queryByText("Gone")).toBeNull();
  });

  it("ignores ?changed=true when there is no diff (first scan)", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?changed=true");
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={rows} deprecatedTotal={0} diff={null} packages={[]} canEdit />);
    expect(screen.getByText("Same")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /since previous scan/ })).toBeNull();
    expect(occurrencesOf("Grew")).toBe("9");
    expect(screen.getAllByRole("columnheader")).toHaveLength(5);
    // Inert, so the toolbar does not read as filtering: the plain total, not "3 of 3".
    expect(screen.queryByText(sentence("3 of 3 components"))).toBeNull();
    expect(screen.getByText(sentence("3 components"))).toBeInTheDocument();
  });

  it("ignores ?changed=true when only the deprecated count moved: every row, no chip, no Δ", () => {
    const deprecatedOnly: ScanDiff = { ...diff, marks: {}, added: 0, removed: 0, changed: 0, removedRows: [], deprecatedPrev: 1, deprecatedNow: 0 };
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?changed=true");
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={rows} deprecatedTotal={0} diff={deprecatedOnly} packages={[]} canEdit />);
    for (const name of ["Same", "Grew", "Fresh"]) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /since previous scan/ })).toBeNull();
    expect(occurrencesOf("Grew")).toBe("9");
    expect(screen.getByRole("columnheader", { name: "Uses" })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByText(sentence("3 components"))).toBeInTheDocument();
  });

  it("keeps a tagged ghost under tag:forms and hides an untagged one; chip and toolbar count what the tag leaves, anchored to the whole view", () => {
    // Ghost tags resolve through resolveTags, not copied off a live row: a
    // removed component's package can still carry a tag.
    const forms = { id: "t-forms", value: "forms", category: null, color: "teal" as const };
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
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={tagged} deprecatedTotal={0} diff={taggedDiff} packages={[]} canEdit />);
    expect(screen.getByText("FormsGhost")).toBeInTheDocument();
    expect(screen.getByText("FormsNew")).toBeInTheDocument();
    expect(screen.queryByText("OtherGhost")).toBeNull();
    expect(screen.queryByText("OtherNew")).toBeNull();
    // The chip counts under the tag too, agreeing with the toolbar's 2; the toolbar keeps the view's 5 as its anchor.
    expect(sinceChip().textContent).toBe("since previous scan2");
    expect(screen.getByText(sentence("2 of 5 changes · 1 added · 1 removed"))).toBeInTheDocument();
  });

  it("the deprecated chip reads its count alone in the changed view, where removed rows can take it past the status line's count", () => {
    const withDeprecated = rows.map((r) => (r.componentId === "grew" ? { ...r, deprecated: true } : r));
    const deprecatedGhost: ScanDiff = { ...diff, removedRows: diff.removedRows.map((r) => ({ ...r, deprecated: true })) };
    // origin=external keeps every row and is another filter, so only the changed view keeps `of 1` off.
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?changed=true&origin=external");
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={withDeprecated} deprecatedTotal={1} diff={deprecatedGhost} packages={[]} canEdit />);
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
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={faceted} deprecatedTotal={2} diff={facetedDiff} packages={[]} canEdit />);
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
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={faceted} deprecatedTotal={2} diff={facetedDiff} packages={[]} canEdit />);
    // Deprecated counts the view's rows: Alpha.
    expect(screen.getByRole("button", { name: /^deprecated/ }).textContent).toBe("deprecated1");
    await openPackages();
    expect(menuRow(/^@x\/old/)?.textContent).toBe("@x/old1");
    expect(menuRow(/^@x\/lib/)?.textContent).toBe("@x/lib1");
    expect(menuRow(/^@y\/ui/)).toBeNull(); // Gamma did not move
  });

  it("a selected package the other filters leave at 0 stays listed, and a pressed chip they empty stays pressed at 0", async () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?package=@y/ui&deprecated=true");
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={faceted} deprecatedTotal={2} diff={facetedDiff} packages={[]} canEdit />);
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

  it("leaves a row the latest scan doesn't have unlinked in both views", () => {
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={rows} notInLatest={["fresh"]} deprecatedTotal={0} diff={diff} packages={[]} canEdit />);
    const expectUnlinked = () => {
      const tr = screen.getByText("Fresh").closest("tr") as HTMLElement;
      expect(tr.querySelector("a")).toBeNull();
      expect(screen.getByRole("link", { name: "Grew" })).toHaveAttribute("href", "/repos/r1/components/grew");
    };
    expectUnlinked();
    fireEvent.click(sinceChip());
    expectUnlinked();
  });
});

describe("ComponentsExplorer same-named rows", () => {
  beforeEach(() => window.history.replaceState(null, "", "http://localhost:3000/repos/r1"));
  const named = (componentId: string, packageName: string, displayName: string, disambiguator: string): ComponentRow =>
    ({ ...base, componentId, packageName, displayName, disambiguator });
  const explorer = (given: ComponentRow[]) =>
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={given} deprecatedTotal={0} diff={null} packages={[]} canEdit />);

  it("shows the part of the path that tells rows of one package and name apart, with the full path kept for screen readers and copy", () => {
    explorer([
      named("aa", "@x/a", "Card", "src/a/Card.tsx"),
      named("ab", "@x/a", "Card", "src/b/Card.tsx"),
      named("ba", "@x/b", "Card", "lib/a/Card.tsx"),
      named("bc", "@x/b", "Card", "lib/c/Card.tsx"),
    ]);
    for (const [path, shown] of [["src/a/Card.tsx", "a"], ["src/b/Card.tsx", "b"], ["lib/a/Card.tsx", "a"], ["lib/c/Card.tsx", "c"]] as const) {
      const full = screen.getByText(path);
      expect(full).toHaveClass("sr-only");
      const short = full.previousElementSibling as HTMLElement;
      expect(short.textContent).toBe(shown);
      expect(short).toHaveAttribute("aria-hidden", "true");
      expect(short).toHaveClass("select-none");
    }
  });

  it("shows the full path, wrapping at slashes, when nothing in it tells the rows apart", () => {
    explorer([named("p1", "@x/a", "Panel", "src/panel/Panel.tsx"), named("p2", "@x/a", "Panel", "src/panel/Panel.tsx")]);
    const lines = screen.getAllByText("src/panel/Panel.tsx");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.querySelectorAll("wbr")).toHaveLength(2);
      expect(line.querySelector(".sr-only, [aria-hidden]")).toBeNull();
    }
  });
});

describe("ComponentsExplorer ?used-in", () => {
  beforeEach(() => window.history.replaceState(null, "", "http://localhost:3000/repos/r1"));

  const counts = (occurrenceCount: number, fileCount: number) => ({ occurrenceCount, fileCount });
  const usedInRows: ComponentRow[] = [
    { ...base, componentId: "a", displayName: "SharedButton", occurrenceCount: 4, fileCount: 3,
      usedIn: { "@example/web": counts(2, 1), "@example/playground": counts(1, 1), "whole-repo-scope": counts(1, 1) } },
    { ...base, componentId: "b", displayName: "Button", occurrenceCount: 2, fileCount: 2,
      usedIn: { "@example/web": counts(1, 1), "@example/shared-ui": counts(1, 1) } },
    { ...base, componentId: "c", displayName: "Demo", occurrenceCount: 0, fileCount: 0 },
  ];
  const usedInDiff: ScanDiff = {
    baselineScanId: "S1",
    baselineCommittedAt: "2026-09-01T00:00:00.000Z",
    marks: { b: { kind: "changed", delta: 1 }, gone: { kind: "removed" } },
    added: 0, removed: 1, changed: 1,
    removedRows: [{ componentId: "gone", displayName: "Gone", packageName: "@x/lib", scope: "external", kind: "react-component", occurrenceCount: 3, deprecated: false, tags: [] }],
    deprecatedPrev: 0, deprecatedNow: 0,
  };
  const packages = [
    { name: "whole-repo-scope", folder: "" },
    { name: "@example/playground", folder: "apps/playground" },
    { name: "@example/web", folder: "apps/web" },
    { name: "@example/shared-ui", folder: "packages/shared-ui" },
  ];
  const renderExplorer = () =>
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={usedInRows} deprecatedTotal={0} diff={usedInDiff} packages={packages} canEdit />);

  it("narrows to the components used in the package, shows that package's uses, and counts its components as the total", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?used-in=@example/web");
    renderExplorer();
    expect(occurrencesOf("SharedButton")).toBe("2");
    expect(occurrencesOf("Button")).toBe("1");
    expect(screen.queryByText("Demo")).toBeNull();
    expect(screen.getByText(sentence("2 components"))).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search components by name" }), { target: { value: "shared" } });
    expect(screen.getByText(sentence("1 of 2 components"))).toBeInTheDocument();
  });

  it("links a component used in more than one package to its Usage tab with the package picked", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?used-in=@example/web");
    const onlyWeb: ComponentRow = { ...base, componentId: "d", displayName: "Card", occurrenceCount: 3, fileCount: 2, usedIn: { "@example/web": counts(3, 2) } };
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={[...usedInRows, onlyWeb]} deprecatedTotal={0} diff={usedInDiff} packages={packages} canEdit />);
    expect(screen.getByRole("link", { name: "Button" })).toHaveAttribute("href", "/repos/r1/components/b?area=@example/web");
    expect(screen.getByRole("link", { name: "Card" })).toHaveAttribute("href", "/repos/r1/components/d");
  });

  // Every row is deprecated: the repo has 3, @example/web has 2, and `q=shared` leaves 1.
  it.each([
    { when: "Used in and a search", query: "used-in=@example/web&q=shared", text: "deprecated1 of 2" },
    { when: "only Used in", query: "used-in=@example/web", text: "deprecated2" },
    { when: "only a search", query: "q=shared", text: "deprecated1 of 3" },
  ])("with $when, the deprecated chip reads $text", ({ query, text }) => {
    window.history.replaceState(null, "", `http://localhost:3000/repos/r1?${query}`);
    const deprecatedRows = usedInRows.map((r) => ({ ...r, deprecated: true }));
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={deprecatedRows} deprecatedTotal={3} diff={usedInDiff} packages={packages} canEdit />);
    expect(screen.getByRole("button", { name: /^deprecated/ }).textContent).toBe(text);
  });

  it("keeps the pill of a package the scan doesn't have and says no components match", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?used-in=@example/renamed");
    renderExplorer();
    expect(screen.getByText("No components match these filters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove used in @example/renamed" })).toBeInTheDocument();
  });

  it("shows the package's components, not the changes since the previous scan, when the link asks for both", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?used-in=@example/web&changed=true");
    renderExplorer();
    expect(occurrencesOf("SharedButton")).toBe("2");
    expect(occurrencesOf("Button")).toBe("1");
    expect(screen.queryByText("Gone")).toBeNull();
    expect(screen.queryByRole("button", { name: /since previous scan/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /^Change/ })).toBeNull();
  });
});

describe("ComponentsExplorer details", () => {
  /** Media queries match as they would at `width` pixels. */
  function viewport(width: number) {
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: Number(/([\d.]+)rem/.exec(query)?.[1]) * 16 <= width, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }) as MediaQueryList);
  }
  const reads = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/other-repos")
    ? { grew: 1 }
    : { source: null, props: { kept: true, uses: 9, top: [], neverSet: null } })));
  const otherRepos = "/api/repos/r1/components/other-repos?scan=S2";
  beforeEach(() => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1");
    reads.mockClear();
    vi.stubGlobal("fetch", reads);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const explorer = (source: SourceRef | null = null) => render(<ComponentsExplorer repoId="r1" scanId="S2" source={source} rows={rows} deprecatedTotal={0} diff={diff} packages={[]} canEdit />);
  const toggle = () => screen.getByRole("button", { name: "Details" });
  const rowButton = (name: string) => screen.getByRole("button", { name: `Details for ${name}` });

  it("from 1024px opens beside the table on the first row, and closes and opens again from the toggle and the close button", () => {
    viewport(1024);
    explorer();
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("complementary", { name: "Details for Grew" })).toBeInTheDocument();
    const spoken = () => document.querySelector('[aria-live="polite"].sr-only')?.textContent;
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("complementary", { name: /^Details for/ })).toBeNull();
    expect(spoken()).toBe("Details hidden");
    fireEvent.click(toggle());
    expect(spoken()).toBe("Details shown for Grew");
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("complementary", { name: /^Details for/ })).toBeNull();
    fireEvent.click(rowButton("Same"));
    expect(screen.getByRole("complementary", { name: "Details for Same" })).toBeInTheDocument();
  });

  it("opens the details from the selected row's button and never closes them from it, leaving Enter and Space to the browser's click", () => {
    viewport(1024);
    explorer();
    const details = () => screen.queryByRole("complementary", { name: "Details for Grew" });
    expect(fireEvent.keyDown(rowButton("Grew"), { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(rowButton("Grew"), { key: " " })).toBe(true);
    expect(details()).toBeInTheDocument();
    fireEvent.click(toggle());
    fireEvent.click(rowButton("Grew"));
    expect(details()).toBeInTheDocument();
    fireEvent.click(rowButton("Grew"));
    expect(details()).toBeInTheDocument();
  });

  it("shows a clicked row's details and says its facts to screen readers", () => {
    viewport(1440);
    explorer();
    fireEvent.click(rowButton("Same"));
    expect(screen.getByRole("complementary", { name: "Details for Same" })).toBeInTheDocument();
    expect(screen.getByText("Same. 4 uses in 1 file. No change since previous scan.")).toHaveAttribute("aria-live", "polite");
  });

  it("says the selected row's change beside the table, except in the changed view, whose Change column says it", () => {
    viewport(1024);
    const details = () => screen.getByRole("complementary", { name: /^Details for/ });
    const { unmount } = explorer();
    expect(within(details()).getByText("+3 since previous scan")).toBeInTheDocument();
    unmount();
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1?changed=true");
    explorer();
    expect(within(details()).queryByText(/since previous scan|in this scan/)).toBeNull();
  });

  it("below 1024px opens a bottom sheet from a row click, starting closed and reading no details while closed", async () => {
    vi.useFakeTimers();
    viewport(1023);
    explorer();
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(reads.mock.calls.map(([url]) => url)).toEqual([otherRepos]);
    fireEvent.click(rowButton("Same"));
    expect(within(screen.getByRole("dialog", { name: "Details for Same" })).queryByRole("button", { name: "Next component" })).toBeNull();
  });

  it("reads every row's other repos once, and a row's details once the selection rests, again only for a row it hasn't read", async () => {
    vi.useFakeTimers();
    viewport(1440);
    explorer();
    const requested = () => reads.mock.calls.map(([url]) => url);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(requested()).toEqual([otherRepos, "/api/repos/r1/components/grew?scan=S2"]);
    const link = (name: string) => within(screen.getByRole("table")).getByRole("link", { name });
    fireEvent.keyDown(link("Grew"), { key: "ArrowDown" });
    await act(() => vi.advanceTimersByTimeAsync(50));
    fireEvent.keyDown(link("Same"), { key: "ArrowDown" });
    await act(() => vi.advanceTimersByTimeAsync(200));
    fireEvent.keyDown(link("Fresh"), { key: "ArrowUp" });
    await act(() => vi.advanceTimersByTimeAsync(50));
    fireEvent.keyDown(link("Same"), { key: "ArrowUp" });
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(requested().slice(2)).toEqual(["/api/repos/r1/components/fresh?scan=S2"]);
    expect(screen.getByRole("link", { name: "1 other repo" })).toHaveAttribute("href", "/components/grew");
  });

  const used = { occurrenceCount: 1, fileCount: 1 };
  const replacementUsedIn = (...packages: string[]): ComponentRow[] =>
    [{ ...base, componentId: "new", displayName: "New", usedIn: Object.fromEntries(packages.map((p) => [p, used])) }];
  it.each<[string, string, ComponentRow[], string[], string, string | null]>([
    ["links the replacement to its page when the repo has it", "Same", [], [], "", "/repos/r1/components/same"],
    ["names the replacement as plain text when the repo doesn't have it", "Missing", [], [], "", null],
    ["names the replacement as plain text when only an older scan has it", "Same", [], ["same"], "", null],
    ["keeps the Used in package in the replacement's link when the replacement is used there", "New", replacementUsedIn("@x/web", "@x/admin"), [], "?used-in=@x/web", "/repos/r1/components/new?area=@x/web"],
    ["leaves the Used in package out of the replacement's link when the replacement isn't used there", "New", replacementUsedIn("@x/admin", "@x/docs"), [], "?used-in=@x/web", "/repos/r1/components/new"],
  ])("%s", (_title, exportName, more, notInLatest, search, href) => {
    window.history.replaceState(null, "", `http://localhost:3000/repos/r1${search}`);
    viewport(1024);
    const replaced: ComponentRow = {
      ...base, componentId: "old", displayName: "OldButton", occurrenceCount: 20, deprecated: true, usedIn: { "@x/web": { occurrenceCount: 20, fileCount: 2 } },
      migration: { status: { status: "superseded", by: { packageName: "@x/lib", exportName } }, recordId: "g1" },
    };
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={[replaced, ...more, ...rows]} notInLatest={notInLatest} deprecatedTotal={1} diff={null} packages={[]} canEdit />);
    const details = within(screen.getByRole("complementary", { name: "Details for OldButton" }));
    const name = `@x/lib/${exportName}`;
    if (href) expect(details.getByRole("link", { name })).toHaveAttribute("href", href);
    else expect(details.getByTitle(name).closest("a")).toBeNull();
  });

  it.each<[string, string, boolean]>([
    ["links a whole replacement package to the table filtered to it when the repo uses it", "@x/lib", true],
    ["names a whole replacement package as plain text when the repo doesn't use it", "@x/none", false],
  ])("%s", (_title, packageName, linked) => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/r1");
    viewport(1024);
    const replaced: ComponentRow = {
      ...base, componentId: "old", packageName: "@x/old", displayName: "OldButton", occurrenceCount: 20, deprecated: true,
      migration: { status: { status: "superseded", by: { packageName } }, recordId: "g1" },
    };
    render(<ComponentsExplorer repoId="r1" scanId="S2" source={null} rows={[replaced, ...rows]} deprecatedTotal={1} diff={null} packages={[]} canEdit />);
    const details = within(screen.getByRole("complementary", { name: "Details for OldButton" }));
    if (linked) expect(details.getByRole("link", { name: packageName })).toHaveAttribute("href", packageFilterHref("r1", packageName));
    else expect(details.getByTitle(packageName).closest("a")).toBeNull();
  });

  /** Holds each details read until `land` answers it; the other repos read answers at once. */
  function heldReads() {
    const held = new Map<string, (facts: ComponentPanelFacts) => void>();
    vi.stubGlobal("fetch", vi.fn((url: string) => url === otherRepos
      ? Promise.resolve(new Response("{}"))
      : new Promise<Response>((resolve) => held.set(url, (facts) => resolve(new Response(JSON.stringify(facts)))))));
    return async (id: string, facts: ComponentPanelFacts) => {
      held.get(`/api/repos/r1/components/${id}?scan=S2`)?.(facts);
      await act(() => vi.advanceTimersByTimeAsync(0));
    };
  }
  const topProp = (name: string, label: string, count: number): ComponentPanelFacts => ({
    source: { filePath: `src/${name}.tsx`, line: 1 }, props: { kept: true, uses: count, top: [{ name, set: count, values: [{ kind: "value", label, count }] }], neverSet: null },
  });
  const aside = () => screen.getByRole("complementary", { name: /^Details for/ });

  it("keeps the last details, faded, busy and unlinked, until the next component's land", async () => {
    vi.useFakeTimers();
    viewport(1440);
    const land = heldReads();
    explorer({ remote: { host: "github.com", href: "https://github.com/example/app" } as never, commit: "abc" });
    await act(() => vi.advanceTimersByTimeAsync(200));
    await land("grew", topProp("variant", "primary", 9));
    expect(screen.getByRole("link", { name: "variant primary, 9 uses" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Grew source" })).toBeInTheDocument();
    fireEvent.keyDown(within(screen.getByRole("table")).getByRole("link", { name: "Grew" }), { key: "ArrowDown" });
    expect(within(aside()).getByRole("heading", { level: 2, name: "Same" })).toBeInTheDocument();
    const busy = () => aside().querySelector('[aria-busy="true"]');
    expect(busy()).toHaveClass("opacity-60");
    expect(within(busy() as HTMLElement).getByLabelText("variant primary, 9 uses").tagName).toBe("SPAN");
    expect(screen.queryByRole("link", { name: /source/ })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(busy()).toHaveTextContent("variant");
    await land("same", topProp("size", "small", 4));
    expect(busy()).toBeNull();
    expect(screen.queryByLabelText("variant primary, 9 uses")).toBeNull();
    expect(screen.getByRole("link", { name: "size small, 4 uses" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Same source" })).toHaveAttribute("href", "https://github.com/example/app/blob/abc/src/size.tsx#L1");
  });

  it("holds the props' space while the first details load, and shows their skeleton only once the read is slow", async () => {
    vi.useFakeTimers();
    viewport(1440);
    heldReads();
    explorer();
    const skeleton = () => within(aside()).getByRole("list", { hidden: true }).parentElement;
    await act(() => vi.advanceTimersByTimeAsync(150 + 399));
    expect(skeleton()).toHaveClass("invisible");
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(skeleton()).not.toHaveClass("invisible");
  });
});
