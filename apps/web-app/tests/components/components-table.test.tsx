// @vitest-environment jsdom
import { describe, it, expect, } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { ComponentsTable } from "@/components/repos/components-table";
import { ghostRow } from "@/lib/scan-diff-view";

import type { ComponentRow, DiffMark } from "@scoutui/web-shared";

const row: ComponentRow = {
  componentId: "c1", kind: "react-component", scope: "external", packageName: "@x/lib",
  displayName: "Button", disambiguator: null, version: "1.0.0",
  occurrenceCount: 7, fileCount: 2, deprecated: false,
};

describe("ComponentsTable", () => {
  it("renders one row per component with the displayed fields", () => {
    render(<ComponentsTable repoId="r1" rows={[row]} />);
    expect(screen.getByText("Button")).toBeInTheDocument();
    // Package / version / counts each render twice: the desktop cell and the
    // sm:hidden stacked mobile tier.
    expect(screen.getAllByText("@x/lib").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1.0.0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("7").length).toBeGreaterThan(0);
  });

  it("says which written name the search matched when the component's name doesn't contain it", () => {
    const header: ComponentRow = { ...row, componentId: "c2", displayName: "Header", writtenNames: ["PageHeader", "SettingsHeader"] };
    const { rerender } = render(<ComponentsTable repoId="r1" rows={[header]} search="settings" />);
    expect(screen.getByText(/^written as/).textContent).toBe("written as SettingsHeader");
    rerender(<ComponentsTable repoId="r1" rows={[header]} search="head" />);
    expect(screen.queryByText(/^written as/)).toBeNull();
  });

  it("has exactly one link per row, named by the component, to its detail page", () => {
    render(<ComponentsTable repoId="r1" rows={[row]} />);
    const link = screen.getByRole("link", { name: "Button" });
    expect(link).toHaveAttribute("href", "/repos/r1/components/c1");
    const tr = link.closest("tr") as HTMLElement;
    expect(within(tr).getAllByRole("link")).toHaveLength(1);
  });

  it("puts aria-sort on the active column header, not the button", () => {
    render(<ComponentsTable repoId="r1" rows={[row]} />);
    expect(screen.getByRole("columnheader", { name: /uses/i })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: /^component/i })).toHaveAttribute("aria-sort", "none");
    expect(screen.getByRole("button", { name: /uses/i })).not.toHaveAttribute("aria-sort");
  });

  it("URL-encodes repoId and componentId with special characters", () => {
    const odd: ComponentRow = { ...row, componentId: "c/1#tricky" };
    render(<ComponentsTable repoId="repo with space" rows={[odd]} />);
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute(
      "href",
      "/repos/repo%20with%20space/components/c%2F1%23tricky",
    );
  });

  it("marks a deprecated row with the orange warning glyph after the name, not a pill; the name stays ink", () => {
    const { rerender } = render(<ComponentsTable repoId="r1" rows={[row]} />);
    expect(screen.queryByText(/deprecated/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Button" })).toHaveAttribute("title", "Button");
    rerender(<ComponentsTable repoId="r1" rows={[{ ...row, deprecated: true }]} />);
    const word = screen.getByText("deprecated");
    expect(word.className).toBe("sr-only");
    const mark = word.parentElement as HTMLElement;
    expect(mark.className).toBe("inline-flex shrink-0 text-status-warn");
    expect(mark.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(mark.closest("tr")?.querySelector(".rounded-4xl")).toBeNull();
    const name = screen.getByRole("link", { name: "Button" });
    expect(name).toHaveAttribute("title", "Button (deprecated)");
    expect(name.className).not.toMatch(/status-err|status-warn|destructive/);
    expect(name.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The empty and no-match states belong to the page's ComponentsSection: the
  // table renders only when there are rows.

  it("marks a row without a package with the explanatory title", () => {
    render(<ComponentsTable repoId="r1" rows={[{ ...row, packageName: null }]} />);
    const dashes = screen.getAllByText("—");
    expect(
      dashes.some((d) => d.closest("td")?.getAttribute("title") === "no import links this usage to a package"),
    ).toBe(true);
  });

  describe("no Origin column", () => {
    it("has no Origin or Library column header, and external/local do not render for a row", () => {
      render(<ComponentsTable repoId="r1" rows={[row]} />);
      expect(screen.queryByRole("columnheader", { name: /origin/i })).toBeNull();
      expect(screen.queryByRole("columnheader", { name: /library/i })).toBeNull();
      expect(screen.queryByText("external")).toBeNull();
      expect(screen.queryByText("local")).toBeNull();
    });
  });

  describe("version sort", () => {
    const v = (id: string, version: string | null): ComponentRow => ({
      ...row, componentId: id, displayName: id, version,
    });
    const names = () => screen.getAllByRole("link").map((l) => l.textContent);

    it("sorts 1.5.0 before 1.14.11 ascending, and keeps unversioned rows last both ways", () => {
      render(<ComponentsTable repoId="r1" rows={[v("A", "1.14.11"), v("N", null), v("B", "1.5.0")]} />);
      fireEvent.click(screen.getByRole("button", { name: /version/i }));
      expect(names()).toEqual(["B", "A", "N"]);
      fireEvent.click(screen.getByRole("button", { name: /version/i }));
      expect(names()).toEqual(["A", "B", "N"]);
    });
  });

  describe("changed view (scan diff)", () => {
    const removed = ghostRow({
      componentId: "gone", displayName: "OldModal", packageName: "@x/lib", scope: "external",
      kind: "react-component", occurrenceCount: 5, deprecated: false, tags: [],
    });
    const rowOf = (el: HTMLElement) => el.closest("tr") as HTMLElement;

    const headers = () =>
      screen.getAllByRole("columnheader").map((h) => ({ name: h.textContent, width: h.className.match(/w-\[\d+%\]/)?.[0] }));
    const FIVE = [
      { name: "Component", width: "w-[40%]" },
      { name: "Package", width: "w-[23%]" },
      { name: "Version", width: "w-[11%]" },
      { name: "Files", width: "w-[9%]" },
      { name: "Uses", width: "w-[17%]" },
    ];
    const occurrencesCell = (tr: HTMLElement) => within(tr).getAllByRole("cell").at(-1) as HTMLElement;
    const DELTA_SORT_NAME = "Uses, sorts by change since previous scan";

    it("renders the same five columns at the same widths in both views, so toggling reflows nothing", () => {
      const { unmount } = render(<ComponentsTable repoId="r1" rows={[row]} />);
      expect(headers()).toEqual(FIVE);
      expect(within(rowOf(screen.getByText("Button"))).getAllByRole("cell")).toHaveLength(5);
      unmount();
      render(<ComponentsTable repoId="r1" rows={[row, removed]} marks={{ c1: { kind: "changed", delta: 2 }, gone: { kind: "removed" } }} />);
      expect(headers()).toEqual(FIVE);
      expect(within(rowOf(screen.getByText("Button"))).getAllByRole("cell")).toHaveLength(5);
      expect(within(rowOf(screen.getByText("OldModal"))).getAllByRole("cell")).toHaveLength(5);
    });

    it("outside the changed view the Uses cell is the bare medium-weight count", () => {
      render(<ComponentsTable repoId="r1" rows={[{ ...row, occurrenceCount: 49 }]} />);
      const cell = occurrencesCell(rowOf(screen.getByText("Button")));
      expect(cell.textContent).toBe("49");
      expect(cell.className).toMatch(/(^|\s)font-medium(\s|$)/);
    });

    it("in the changed view the Uses cell reads `49 (+2)`: the count muted, the Δ medium ink in a fixed-width slot", () => {
      render(<ComponentsTable repoId="r1" rows={[{ ...row, occurrenceCount: 49 }]} marks={{ c1: { kind: "changed", delta: 2 } }} />);
      const cell = occurrencesCell(rowOf(screen.getByText("Button")));
      expect(cell.textContent).toBe("49 (+2)");
      expect(cell.className).toMatch(/text-muted-foreground/);
      expect(cell.className).not.toMatch(/(^|\s)font-medium(\s|$)/);
      const delta = within(cell).getByText("+2");
      expect(delta.className).toBe("font-medium text-foreground");
      expect(delta.parentElement?.className).toBe("inline-block text-left");
    });

    it("gives every Δ slot the width of the table's widest Δ, so brackets share a left edge", () => {
      const small = { ...row, componentId: "s", displayName: "Small", occurrenceCount: 49 };
      const big = { ...row, componentId: "b", displayName: "Big", occurrenceCount: 12345 };
      const slotOf = (name: string) => occurrencesCell(rowOf(screen.getByText(name))).querySelector("span.inline-block") as HTMLElement;
      const { unmount } = render(
        <ComponentsTable repoId="r1" rows={[small, big]} marks={{ s: { kind: "changed", delta: 2 }, b: { kind: "changed", delta: -1234 } }} />,
      );
      // `(−1,234)`: 5 full-width glyphs + 3 narrow at half + ½ slack = 7ch, shared by `(+2)`.
      expect(slotOf("Small").style.width).toBe("7ch");
      expect(slotOf("Big").style.width).toBe("7ch");
      expect(occurrencesCell(rowOf(screen.getByText("Big"))).textContent).toBe("12,345 (−1,234)");
      unmount();
      // A table whose widest Δ is `(+2)` reserves only 3.5ch.
      render(<ComponentsTable repoId="r1" rows={[small]} marks={{ s: { kind: "changed", delta: 2 } }} />);
      expect(slotOf("Small").style.width).toBe("3.5ch");
    });

    it("renders a removed row as an unlinked, unfocusable ghost reading `0 (−5)`", () => {
      const marks: Record<string, DiffMark> = { gone: { kind: "removed" } };
      render(<ComponentsTable repoId="r1" rows={[removed]} marks={marks} />);
      const name = screen.getByText("OldModal");
      const tr = rowOf(name);
      // Full opacity, for contrast: muted ink says "not live" instead.
      expect(tr.className).not.toMatch(/opacity-/);
      expect(name.className).toMatch(/text-muted-foreground/);
      // `removed` is an outline Badge (a metadata chip), a word rather than a colour
      // cue, with a border that reads on the dark panel and a muted word.
      const marker = within(tr).getByText("removed");
      expect(marker.className).toMatch(/rounded-4xl/);
      expect(marker.className).toMatch(/border-muted-foreground\/70/);
      expect(marker.className).not.toMatch(/border-border/);
      expect(marker.className).toMatch(/text-muted-foreground/);
      // Below sm the tier reads the same in words: `0 uses (−5)`, no trailing segment.
      const tier = within(tr).getByText(/^uses/).parentElement as HTMLElement;
      expect(tier.textContent).toBe("0 uses (−5)");
      // No link and no tab stop: there is no detail page to reach.
      expect(within(tr).queryAllByRole("link")).toHaveLength(0);
      expect(tr.querySelector("a, button, [tabindex]")).toBeNull();
      // Desktop: a faint zero (it has none now), then the lost count as the Δ.
      const cell = occurrencesCell(tr);
      expect(cell.textContent).toBe("0 (−5)");
      expect(within(cell).getByText("0").className).toBe("text-faint");
      expect(within(cell).getByText("−5").className).toMatch(/font-medium/);
      expect(within(tr).getAllByText("—")).toHaveLength(2); // version, files
      expect(within(tr).queryByText(/^(external|local)$/)).toBeNull(); // no origin word: the table has no Origin column
    });

    it("a deprecated component's Δ takes the retirement polarity, mobile tier and desktop cell; other rows stay ink", () => {
      const depGrew = { ...row, componentId: "dg", displayName: "DepGrew", occurrenceCount: 12, deprecated: true };
      const plainGrew = { ...row, componentId: "pg", displayName: "PlainGrew", occurrenceCount: 12 };
      const depGone = ghostRow({
        componentId: "dgone", displayName: "DepGone", packageName: "@x/lib", scope: "external",
        kind: "react-component", occurrenceCount: 4, deprecated: true, tags: [],
      });
      render(
        <ComponentsTable
          repoId="r1"
          rows={[depGrew, plainGrew, depGone]}
          marks={{ dg: { kind: "changed", delta: 3 }, pg: { kind: "changed", delta: 3 }, dgone: { kind: "removed" } }}
        />,
      );
      // The mobile tier's ` (+3)` comes first in the row, the desktop slot's `(+3)` last.
      const classesOf = (name: string, delta: string) =>
        within(rowOf(screen.getByText(name))).getAllByText(delta).map((el) => el.className);
      expect(classesOf("DepGrew", "+3")).toEqual(["font-medium tabular-nums text-status-err", "font-medium text-status-err"]);
      expect(classesOf("DepGone", "−4")).toEqual(["font-medium tabular-nums text-foreground", "font-medium text-foreground"]);
      expect(classesOf("PlainGrew", "+3")).toEqual(["font-medium tabular-nums text-foreground", "font-medium text-foreground"]);
    });

    it("marks a zero-occurrence added row in words, never ±0", () => {
      const held = { ...row, componentId: "held", displayName: "Held", occurrenceCount: 0, fileCount: 0 };
      const moved = { ...row, componentId: "m", displayName: "Moved", occurrenceCount: 36 };
      render(<ComponentsTable repoId="r1" rows={[held, moved]} marks={{ held: { kind: "added" }, m: { kind: "changed", delta: -23 } }} />);
      const tr = rowOf(screen.getByText("Held"));
      // The same outline badge as `removed`, then the muted words.
      const badge = within(tr).getByText("added");
      expect(badge.className).toMatch(/rounded-4xl/);
      expect(badge.className).toMatch(/border-muted-foreground\/70/);
      const zero = within(tr).getByText("0 uses");
      expect(zero.className).toMatch(/text-muted-foreground/);
      expect(badge.compareDocumentPosition(zero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(tr.textContent).not.toContain("±0");
      // A zero Δ shows no brackets and no dash; the empty slot keeps its width so the count lines up.
      const cell = occurrencesCell(tr);
      expect(cell.textContent).toBe("0 ");
      const slot = cell.querySelector("span.inline-block") as HTMLElement;
      expect(slot.className).toBe("inline-block text-left");
      expect(slot.textContent).toBe("");
      // The same width as the `(−23)` slot beside it: 3 full + 2 narrow at half + ½ slack.
      expect(slot.style.width).toBe("4.5ch");
      expect((occurrencesCell(rowOf(screen.getByText("Moved"))).querySelector("span.inline-block") as HTMLElement).style.width).toBe("4.5ch");
    });

    it("an added row with occurrences wears the outline badge alone; a changed row wears no badge", () => {
      const fresh = { ...row, componentId: "fresh", displayName: "Fresh", occurrenceCount: 4 };
      const grew = { ...row, componentId: "grew", displayName: "Grew", occurrenceCount: 9 };
      render(<ComponentsTable repoId="r1" rows={[fresh, grew]} marks={{ fresh: { kind: "added" }, grew: { kind: "changed", delta: 3 } }} />);
      const freshRow = rowOf(screen.getByText("Fresh"));
      expect(within(freshRow).getByText("added").className).toMatch(/rounded-4xl/);
      expect(within(freshRow).queryByText(/0 uses/)).toBeNull();
      const grewRow = rowOf(screen.getByText("Grew"));
      expect(within(grewRow).queryByText(/^(added|removed|changed)$/)).toBeNull();
    });

    it("below sm, a live row's Δ attaches to uses, not files", () => {
      const moved = { ...row, componentId: "m", displayName: "Moved", occurrenceCount: 36, fileCount: 30 };
      render(<ComponentsTable repoId="r1" rows={[moved]} marks={{ m: { kind: "changed", delta: -23 } }} />);
      const tr = rowOf(screen.getByText("Moved"));
      const tier = within(tr).getByText("30 files").parentElement as HTMLElement;
      // The flex tier's dot has no surrounding text, so the tier reads `36 uses (−23)·30 files`.
      expect(tier.textContent).toBe("36 uses (−23)·30 files");
      expect(within(tier).getByText("−23").className).toMatch(/font-medium/);
    });

    it("opens on the signed Δ, biggest drop first, and keeps live rows linked", () => {
      const a = { ...row, componentId: "a", displayName: "Small", occurrenceCount: 9 };
      const b = { ...row, componentId: "b", displayName: "Big", occurrenceCount: 10 };
      const c = { ...row, componentId: "c", displayName: "Shrunk", occurrenceCount: 20 };
      const marks: Record<string, DiffMark> = {
        a: { kind: "changed", delta: 2 },
        b: { kind: "added" },
        c: { kind: "changed", delta: -3 },
        gone: { kind: "removed" },
      };
      render(<ComponentsTable repoId="r1" rows={[a, removed, b, c]} marks={marks} />);
      const names = () => screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
      // Signed, not magnitude: −5, −3, +2, +10. A |Δ| sort would put Big (+10) first.
      const opened = names();
      expect(opened[0]).toContain("OldModal"); // −5
      expect(opened[1]).toContain("Shrunk");   // −3
      expect(opened[2]).toContain("Small");    // +2
      expect(opened[3]).toContain("Big");      // +10
      // The sort lives on the Uses header: the label is unchanged, the key is the Δ.
      expect(screen.getByRole("columnheader", { name: /^Uses/ })).toHaveAttribute("aria-sort", "ascending");
      expect(screen.getByRole("columnheader", { name: "Component" })).toHaveAttribute("aria-sort", "none");
      expect(within(rowOf(screen.getByText("Big"))).getAllByRole("link")).toHaveLength(1);
      expect(occurrencesCell(rowOf(screen.getByText("Small"))).textContent).toBe("9 (+2)");
      // Re-clicking flips to biggest gain first.
      fireEvent.click(screen.getByRole("button", { name: DELTA_SORT_NAME }));
      const flipped = names();
      expect(flipped.map((t) => ["OldModal", "Shrunk", "Small", "Big"].find((n) => t.includes(n)))).toEqual(["Big", "Small", "Shrunk", "OldModal"]);
      expect(screen.getByRole("columnheader", { name: /^Uses/ })).toHaveAttribute("aria-sort", "descending");
    });

    it("names what the Uses header sorts in the changed view only, visible label unchanged", () => {
      const { unmount } = render(<ComponentsTable repoId="r1" rows={[row]} marks={{ c1: { kind: "changed", delta: 2 } }} />);
      const sort = screen.getByRole("button", { name: DELTA_SORT_NAME });
      expect(sort).toHaveAttribute("title", DELTA_SORT_NAME);
      expect(sort.textContent).toBe("Uses");
      unmount();
      render(<ComponentsTable repoId="r1" rows={[row]} />);
      const plain = screen.getByRole("button", { name: "Uses" });
      expect(plain).not.toHaveAttribute("title");
      expect(screen.queryByRole("button", { name: /change since previous scan/ })).toBeNull();
    });

    it("coming back to Uses from another column reopens ascending, biggest drop first", () => {
      const a = { ...row, componentId: "a", displayName: "Gain", occurrenceCount: 9, fileCount: 1 };
      const c = { ...row, componentId: "c", displayName: "Drop", occurrenceCount: 20, fileCount: 7 };
      render(<ComponentsTable repoId="r1" rows={[a, c]} marks={{ a: { kind: "changed", delta: 2 }, c: { kind: "changed", delta: -3 } }} />);
      fireEvent.click(screen.getByRole("button", { name: "Files" }));
      expect(screen.getByRole("columnheader", { name: "Files" })).toHaveAttribute("aria-sort", "descending");
      fireEvent.click(screen.getByRole("button", { name: DELTA_SORT_NAME }));
      expect(screen.getByRole("columnheader", { name: /^Uses/ })).toHaveAttribute("aria-sort", "ascending");
      expect(screen.getAllByRole("row").slice(1).map((r) => (r.textContent ?? "").includes("Drop"))).toEqual([true, false]);
    });

    it("below sm a long name's badges wrap under it instead of widening the table; from sm up the name row is one line", () => {
      const held = { ...row, componentId: "held", displayName: "PharmacyLicenseLogoExample", occurrenceCount: 0, fileCount: 0 };
      render(<ComponentsTable repoId="r1" rows={[held, removed]} marks={{ held: { kind: "added" }, gone: { kind: "removed" } }} />);
      const NAME_ROW = "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 sm:flex-nowrap";
      expect(screen.getByText("added").parentElement?.className).toBe(NAME_ROW);
      expect(screen.getByText("removed").parentElement?.className).toBe(NAME_ROW);
      // The beside-badge `0 uses` note is desktop-only; the mobile tier already says it.
      expect(screen.getByText("0 uses").className).toBe("hidden shrink-0 text-xs text-muted-foreground sm:inline");
      const tier = within(rowOf(screen.getByText("PharmacyLicenseLogoExample"))).getByText("0 files").parentElement as HTMLElement;
      expect(tier.textContent).toBe("0 uses·0 files");
    });

    it("mobile tiers say `1 use` and `1 file`, and a removed row that had no occurrences shows no `(—)`", () => {
      const one = { ...row, componentId: "one", displayName: "One", occurrenceCount: 1, fileCount: 1 };
      const heldGhost = ghostRow({
        componentId: "hg", displayName: "HeldGhost", packageName: "@x/lib", scope: "external",
        kind: "react-component", occurrenceCount: 0, deprecated: false, tags: [],
      });
      render(<ComponentsTable repoId="r1" rows={[one, heldGhost]} marks={{ one: { kind: "changed", delta: 1 }, hg: { kind: "removed" } }} />);
      const tier = within(rowOf(screen.getByText("One"))).getByText("1 file").parentElement as HTMLElement;
      expect(tier.textContent).toBe("1 use (+1)·1 file");
      const ghostTier = within(rowOf(screen.getByText("HeldGhost"))).getByText(/^uses/).parentElement as HTMLElement;
      expect(ghostTier.textContent).toBe("0 uses");
    });
  });
});
