// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { type ComponentProps, useState } from "react";
import { ComponentsTable as Table, typicalNameLength, useSortedRows } from "@/components/repos/components-table";
import { ghostRow } from "@/lib/scan-diff-view";

import type { ComponentRow, DiffMark } from "@scoutui/web-shared";

const row: ComponentRow = {
  componentId: "c1", kind: "react-component", scope: "external", packageName: "@x/lib",
  displayName: "Button", disambiguator: null, version: "1.0.0",
  occurrenceCount: 7, fileCount: 2, deprecated: false,
};

/** The table with the sort the explorer gives it; marks open the changed view unless `changedView` says otherwise. */
function ComponentsTable({ rows, changedView, ...props }: Omit<ComponentProps<typeof Table>, "sort"> & { rows: ComponentRow[]; changedView?: boolean }) {
  return <Table {...props} sort={useSortedRows(rows, props.marks, changedView ?? props.marks !== undefined)} />;
}

describe("ComponentsTable", () => {
  it("renders one row per component with the displayed fields", () => {
    render(<ComponentsTable repoId="r1" rows={[row]} />);
    expect(screen.getByText("Button")).toBeInTheDocument();
    // Package / version / counts each render twice: the column cell and the
    // stacked rows' tier.
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
    expect(screen.getByRole("columnheader", { name: /^component/i })).not.toHaveAttribute("aria-sort");
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

  it.each<[string, number, boolean, number]>([
    ["a short typical name keeps 14rem", 10, false, 16.5 + 14],
    ["a 29-character typical name, beside a Change column", 29, true, 22.5 + 29 * 0.5425 + 1.5],
    ["a long typical name stops at 22rem", 47, false, 16.5 + 22],
  ])("leaves Package the table's width less the fixed columns and Component's room: %s", (_title, nameChars, change, reserved) => {
    render(<ComponentsTable repoId="r1" rows={[row]} nameChars={nameChars} marks={change ? { c1: { kind: "changed", delta: 2 } } : undefined} />);
    const width = screen.getByRole("columnheader", { name: "Package" }).style.width;
    expect(Number(/calc\(100cqw - ([\d.]+)rem\)/.exec(width)?.[1])).toBeCloseTo(reserved);
  });

  it("makes Component's room for the 95th percentile of name lengths, not the longest", () => {
    expect(typicalNameLength(Array.from({ length: 20 }, (_, i) => ({ ...row, displayName: "x".repeat(i + 1) })))).toBe(19);
  });

  it("gives a name the truncated class while its text overflows its box, and stops watching it once the row unmounts", () => {
    const observers: Array<{ watched: Set<Element>; fire: () => void }> = [];
    vi.stubGlobal("ResizeObserver", class {
      watched = new Set<Element>();
      constructor(callback: ResizeObserverCallback) {
        observers.push({ watched: this.watched, fire: () => callback([...this.watched].map((target) => ({ target }) as ResizeObserverEntry), this as unknown as ResizeObserver) });
      }
      observe(element: Element) { this.watched.add(element); }
      unobserve(element: Element) { this.watched.delete(element); }
      disconnect() { this.watched.clear(); }
    });
    try {
      const { unmount } = render(<ComponentsTable repoId="r1" rows={[{ ...row, displayName: "SegmentedControlGroup" }, { ...row, componentId: "c2", displayName: "Tab" }]} />);
      const long = screen.getByRole("link", { name: "SegmentedControlGroup" });
      const short = screen.getByRole("link", { name: "Tab" });
      const textWidth = (element: Element, scrollWidth: number) => {
        Object.defineProperty(element, "scrollWidth", { configurable: true, value: scrollWidth });
        Object.defineProperty(element, "clientWidth", { configurable: true, value: 100 });
      };
      textWidth(long, 180);
      textWidth(short, 40);
      const observer = observers.find((o) => o.watched.has(long));
      observer?.fire();
      expect(long).toHaveClass("truncated");
      expect(short).not.toHaveClass("truncated");
      textWidth(long, 100);
      observer?.fire();
      expect(long).not.toHaveClass("truncated");
      unmount();
      expect(observer?.watched.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // The empty and no-match states belong to the page's ComponentsSection: the
  // table renders only when there are rows.

  it("marks a row without a package with the explanatory title", () => {
    render(<ComponentsTable repoId="r1" rows={[{ ...row, packageName: null }]} />);
    const dashes = screen.getAllByText("—");
    expect(
      dashes.some((d) => d.closest("td")?.getAttribute("title") === "no import links this component to a package"),
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

  describe("unused props pill", () => {
    it.each<[string, NonNullable<ComponentRow["apiUsage"]>, string | null]>([
      ["unused props only", { declaredCount: 5, neverUsedCount: 4, unusedCount: 2, possiblyUnusedCount: 0 }, "2 unused props"],
      ["unused and possibly unused props", { declaredCount: 9, neverUsedCount: 5, unusedCount: 2, possiblyUnusedCount: 3 }, "2 unused · 3 possibly unused"],
      ["only possibly unused props, which the filter doesn't keep", { declaredCount: 9, neverUsedCount: 3, unusedCount: 0, possiblyUnusedCount: 3 }, null],
    ])("reads a row with %s while the filter is on", (_case, apiUsage, text) => {
      render(<ComponentsTable repoId="r1" rows={[{ ...row, componentId: "v", displayName: "Field", apiUsage }]} showUnusedProps />);
      if (text === null) expect(screen.queryByText(/unused/)).toBeNull();
      else expect(within(trOf("Field")).getByText(text)).toBeInTheDocument();
    });

    const panel: ComponentRow = { ...row, componentId: "p", displayName: "Panel", deprecated: true, apiUsage: { declaredCount: 5, neverUsedCount: 2 } };
    const allUsed: ComponentRow = { ...row, componentId: "a", displayName: "Card", apiUsage: { declaredCount: 3, neverUsedCount: 0 } };
    const undeclared: ComponentRow = { ...row, componentId: "u", displayName: "Tag" };
    const trOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

    it("shows nothing about unused props while the filter is off, and adds no column", () => {
      render(<ComponentsTable repoId="r1" rows={[panel]} />);
      expect(screen.queryByText(/unused/)).toBeNull();
      expect(screen.getAllByRole("columnheader")).toHaveLength(5);
    });

    it("reads `N unused props` beside the name while the filter is on, after the deprecated mark", () => {
      render(<ComponentsTable repoId="r1" rows={[panel]} showUnusedProps />);
      const pill = within(trOf("Panel")).getByText("2 unused props");
      expect(pill).toHaveAttribute("title", "5 declared props");
      // In the name line, so it shows on the stacked mobile row too.
      const nameLine = screen.getByRole("link", { name: "Panel" }).parentElement as HTMLElement;
      expect(nameLine).toContainElement(pill);
      expect(within(nameLine).getByText("deprecated").compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getAllByRole("columnheader")).toHaveLength(5);
    });

    it("gives no pill to a component with every declared prop passed, or without a declared API", () => {
      render(<ComponentsTable repoId="r1" rows={[allUsed, undeclared]} showUnusedProps />);
      expect(within(trOf("Card")).queryByText(/unused/)).toBeNull();
      expect(within(trOf("Tag")).queryByText(/unused/)).toBeNull();
    });
  });

  it("sorts names by the numbers in them, Button2 before Button10", () => {
    const named = (name: string): ComponentRow => ({ ...row, componentId: name, displayName: name });
    render(<ComponentsTable repoId="r1" rows={[named("Button10"), named("Button2"), named("Button1")]} />);
    fireEvent.click(screen.getByRole("button", { name: /^component/i }));
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["Button1", "Button2", "Button10"]);
  });

  describe("selection", () => {
    const named = (id: string, displayName: string, occurrenceCount: number): ComponentRow => ({ ...row, componentId: id, displayName, occurrenceCount });
    const rows = [named("a", "Alpha", 30), named("b", "Beta", 20), named("c", "Gamma", 10)];
    const gone = ghostRow({ componentId: "gone", displayName: "Gone", packageName: "@x/lib", scope: "external", kind: "react-component", occurrenceCount: 25, deprecated: false, tags: [] });
    function Selecting({ given = rows, marks, onSelect }: { given?: ComponentRow[]; marks?: Record<string, DiffMark>; onSelect?: (id: string) => void }) {
      const [selectedId, setSelectedId] = useState<string | null>("a");
      return (
        <ComponentsTable repoId="r1" rows={given} marks={marks} changedView={false} selectedId={selectedId}
          onSelect={(id) => { setSelectedId(id); onSelect?.(id); }} />
      );
    }
    const link = (name: string) => screen.getByRole("link", { name });
    const button = (name: string) => screen.getByRole("button", { name: `Details for ${name}` });

    it("selects a row from its button, focusing it and marking it current; a click on the name only follows the link", () => {
      const onSelect = vi.fn();
      render(<Selecting onSelect={onSelect} />);
      expect(button("Alpha")).toHaveAttribute("aria-current", "true");
      fireEvent.click(button("Beta"));
      expect(onSelect).toHaveBeenLastCalledWith("b");
      expect(button("Beta")).toHaveAttribute("aria-current", "true");
      expect(button("Beta")).toHaveFocus();
      expect(button("Alpha")).not.toHaveAttribute("aria-current");
      const stay = (e: Event) => e.preventDefault();
      window.addEventListener("click", stay);
      fireEvent.click(link("Gamma"));
      window.removeEventListener("click", stay);
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("moves the selection and focus between rows' buttons with ↓ and ↑, from a button or a name, past a removed row; the selected row's button, then its name, are the only tab stops", () => {
      render(<Selecting given={[...rows, gone]} marks={{ gone: { kind: "removed" } }} />);
      button("Alpha").focus();
      fireEvent.keyDown(button("Alpha"), { key: "ArrowDown" });
      expect(button("Beta")).toHaveAttribute("aria-current", "true");
      expect(button("Beta")).toHaveFocus();
      fireEvent.keyDown(link("Beta"), { key: "ArrowDown" });
      expect(button("Gamma")).toHaveFocus();
      fireEvent.keyDown(link("Gamma"), { key: "ArrowUp" });
      expect(button("Beta")).toHaveFocus();
      const tabStops = Array.from(document.querySelectorAll<HTMLElement>("tbody a, tbody button")).filter((el) => el.tabIndex === 0);
      expect(tabStops).toEqual([button("Beta"), link("Beta")]);
    });

    it("scrolls the row ↓ moves to into view, in the table and on the page", () => {
      const scrolled: Element[] = [];
      const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) { scrolled.push(this); });
      render(<Selecting given={rows} />);
      button("Alpha").focus();
      fireEvent.keyDown(button("Alpha"), { key: "ArrowDown" });
      expect(scrolled).toEqual([button("Beta").closest("tr")]);
      expect(spy).toHaveBeenCalledWith({ block: "nearest" });
      spy.mockRestore();
    });
  });

  describe("change since the previous scan", () => {
    const removed = ghostRow({
      componentId: "gone", displayName: "OldModal", packageName: "@x/lib", scope: "external",
      kind: "react-component", occurrenceCount: 5, deprecated: false, tags: [],
    });
    const rowOf = (el: HTMLElement) => el.closest("tr") as HTMLElement;

    const headers = () =>
      screen.getAllByRole("columnheader").map((h) => ({ name: h.textContent, width: /^[\d.]+rem$/.test(h.style.width) ? h.style.width : undefined }));
    const FIVE = [
      { name: "Component", width: undefined },
      { name: "Package", width: undefined },
      { name: "Version", width: "6rem" },
      { name: "Files", width: "4.5rem" },
      { name: "Uses", width: "6rem" },
    ];
    const cells = (tr: HTMLElement) => within(tr).getAllByRole("cell");
    const usesCell = (tr: HTMLElement) => cells(tr).at(4) as HTMLElement;
    const changeCell = (tr: HTMLElement) => cells(tr).at(5) as HTMLElement;

    it("adds a Change column only when given the diff's marks, keeping the other columns' widths", () => {
      const { unmount } = render(<ComponentsTable repoId="r1" rows={[row]} />);
      expect(headers()).toEqual(FIVE);
      expect(cells(rowOf(screen.getByText("Button")))).toHaveLength(5);
      unmount();
      render(<ComponentsTable repoId="r1" rows={[row, removed]} marks={{ c1: { kind: "changed", delta: 2 }, gone: { kind: "removed" } }} />);
      expect(headers()).toEqual([...FIVE, { name: "Change", width: "6rem" }]);
      expect(cells(rowOf(screen.getByText("Button")))).toHaveLength(6);
      expect(cells(rowOf(screen.getByText("OldModal")))).toHaveLength(6);
    });

    it("keeps the Uses cell the bare medium-weight count beside a Change column", () => {
      render(<ComponentsTable repoId="r1" rows={[{ ...row, occurrenceCount: 49 }]} marks={{ c1: { kind: "changed", delta: 2 } }} />);
      const cell = usesCell(rowOf(screen.getByText("Button")));
      expect(cell.textContent).toBe("49");
      expect(cell.className).toMatch(/(^|\s)font-medium(\s|$)/);
    });

    it.each<[string, DiffMark | undefined, number, string, string]>([
      ["an added component, as a gain of its uses", { kind: "added" }, 4, "+4", "font-medium text-foreground"],
      ["an added component with no uses, never ±0", { kind: "added" }, 0, "—", "text-faint"],
      ["a gain", { kind: "changed", delta: 1234 }, 1300, "+1,234", "font-medium text-foreground"],
      ["a drop", { kind: "changed", delta: -3 }, 9, "−3", "font-medium text-foreground"],
      ["no change", undefined, 9, "—", "text-faint"],
    ])("reads %s in the Change cell, with an Added badge only when added", (_title, mark, occurrenceCount, text, className) => {
      render(<ComponentsTable repoId="r1" rows={[{ ...row, occurrenceCount }]} marks={mark ? { c1: mark } : { other: { kind: "added" } }} />);
      const cell = changeCell(rowOf(screen.getByText("Button")));
      expect(cell.textContent).toBe(text);
      expect(within(cell).getByText(text).className).toBe(className);
      expect(within(rowOf(screen.getByText("Button"))).queryByText("Added") !== null).toBe(mark?.kind === "added");
    });

    it("renders a removed row as an unlinked, unfocusable ghost reading `0` uses and `−5`", () => {
      const marks: Record<string, DiffMark> = { gone: { kind: "removed" } };
      render(<ComponentsTable repoId="r1" rows={[removed]} marks={marks} />);
      const name = screen.getByTitle("OldModal");
      const tr = rowOf(name);
      // Full opacity, for contrast: muted ink says "not live" instead.
      expect(tr.className).not.toMatch(/opacity-/);
      expect(name.className).toMatch(/text-muted-foreground/);
      // `removed` is an outline Badge (a metadata chip), a word rather than a colour
      // cue, with a border that reads on the dark panel and a muted word.
      const marker = within(tr).getByText("Removed");
      expect(marker.className).toMatch(/rounded-4xl/);
      expect(marker.className).toMatch(/border-muted-foreground\/70/);
      expect(marker.className).not.toMatch(/border-border/);
      expect(marker.className).toMatch(/text-muted-foreground/);
      // Stacked, the tier reads the same in words: `0 uses (−5)`, no trailing segment.
      const tier = within(tr).getByText(/^uses/).parentElement as HTMLElement;
      expect(tier.textContent).toBe("0 uses (−5)");
      // No link and no tab stop: there is no detail page to reach.
      expect(within(tr).queryAllByRole("link")).toHaveLength(0);
      expect(tr.querySelector("a, button, [tabindex]")).toBeNull();
      // Desktop: a muted zero (it has none now), then the lost count as its change.
      expect(usesCell(tr).textContent).toBe("0");
      expect(usesCell(tr).className).toMatch(/text-muted-foreground/);
      expect(changeCell(tr).textContent).toBe("−5");
      expect(within(changeCell(tr)).getByText("−5").className).toMatch(/font-medium/);
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
      // The mobile tier's ` (+3)` comes first in the row, the Change cell's `+3` last.
      const classesOf = (name: string, delta: string) =>
        within(rowOf(screen.getByText(name))).getAllByText(delta).map((el) => el.className);
      expect(classesOf("DepGrew", "+3")).toEqual(["font-medium tabular-nums text-status-err", "font-medium text-status-err"]);
      expect(classesOf("DepGone", "−4")).toEqual(["font-medium tabular-nums text-foreground", "font-medium text-foreground"]);
      expect(classesOf("PlainGrew", "+3")).toEqual(["font-medium tabular-nums text-foreground", "font-medium text-foreground"]);
    });

    it("in stacked rows, a changed or added row's Δ attaches to uses, and an added row's badge sits on its name line", () => {
      const moved = { ...row, componentId: "m", displayName: "Moved", occurrenceCount: 36, fileCount: 30 };
      const fresh = { ...row, componentId: "f", displayName: "Fresh", occurrenceCount: 5, fileCount: 2 };
      render(<ComponentsTable repoId="r1" rows={[moved, fresh]} marks={{ m: { kind: "changed", delta: -23 }, f: { kind: "added" } }} />);
      const tier = within(rowOf(screen.getByText("Moved"))).getByText("30 files").parentElement as HTMLElement;
      // The flex tier's dot has no surrounding text, so the tier reads `36 uses (−23)·30 files`.
      expect(tier.textContent).toBe("36 uses (−23)·30 files");
      expect(within(tier).getByText("−23").className).toMatch(/font-medium/);
      expect((within(rowOf(screen.getByText("Fresh"))).getByText("2 files").parentElement as HTMLElement).textContent).toBe("5 uses (+5)·2 files");
      const badge = screen.getByText("Added");
      expect(badge.parentElement).toBe(screen.getByRole("link", { name: "Fresh" }).parentElement);
      expect(badge.className).toMatch(/border-muted-foreground\/70/);
    });

    it("opens the changed view on the signed change, biggest drop first, no change last both ways, and keeps live rows linked", () => {
      const a = { ...row, componentId: "a", displayName: "Small", occurrenceCount: 9 };
      const b = { ...row, componentId: "b", displayName: "Big", occurrenceCount: 10 };
      const c = { ...row, componentId: "c", displayName: "Shrunk", occurrenceCount: 20 };
      const z = { ...row, componentId: "z", displayName: "Unused", occurrenceCount: 0 };
      const marks: Record<string, DiffMark> = {
        a: { kind: "changed", delta: 2 },
        b: { kind: "added" },
        c: { kind: "changed", delta: -3 },
        z: { kind: "added" },
        gone: { kind: "removed" },
      };
      render(<ComponentsTable repoId="r1" rows={[a, z, removed, b, c]} marks={marks} />);
      const names = () => screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
      // Signed, not magnitude: −5, −3, +2, +10, then the 0. A |Δ| sort would put Big (+10) first.
      const opened = names();
      expect(opened[0]).toContain("OldModal"); // −5
      expect(opened[1]).toContain("Shrunk");   // −3
      expect(opened[2]).toContain("Small");    // +2
      expect(opened[3]).toContain("Big");      // +10
      expect(opened[4]).toContain("Unused");   // 0
      expect(screen.getByRole("columnheader", { name: /^Change/ })).toHaveAttribute("aria-sort", "ascending");
      expect(screen.getByRole("columnheader", { name: /^Uses/ })).not.toHaveAttribute("aria-sort");
      expect(within(rowOf(screen.getByText("Big"))).getAllByRole("link")).toHaveLength(1);
      // Re-clicking flips to biggest gain first.
      fireEvent.click(screen.getByRole("button", { name: "Change since previous scan" }));
      const flipped = names();
      expect(flipped.map((t) => ["OldModal", "Shrunk", "Small", "Big", "Unused"].find((n) => t.includes(n)))).toEqual(["Big", "Small", "Shrunk", "OldModal", "Unused"]);
      expect(screen.getByRole("columnheader", { name: /^Change/ })).toHaveAttribute("aria-sort", "descending");
    });

    it("outside the changed view a Change column still opens most used first", () => {
      const a = { ...row, componentId: "a", displayName: "Gain", occurrenceCount: 9 };
      const c = { ...row, componentId: "c", displayName: "Drop", occurrenceCount: 20 };
      render(<ComponentsTable repoId="r1" rows={[a, c]} marks={{ a: { kind: "changed", delta: 2 }, c: { kind: "changed", delta: -3 } }} changedView={false} />);
      expect(screen.getByRole("columnheader", { name: /^Uses/ })).toHaveAttribute("aria-sort", "descending");
      expect(screen.getAllByRole("row").slice(1).map((r) => (r.textContent ?? "").includes("Drop"))).toEqual([true, false]);
    });

    it("coming back to Change from another column reopens ascending, biggest drop first", () => {
      const a = { ...row, componentId: "a", displayName: "Gain", occurrenceCount: 9, fileCount: 1 };
      const c = { ...row, componentId: "c", displayName: "Drop", occurrenceCount: 20, fileCount: 7 };
      render(<ComponentsTable repoId="r1" rows={[a, c]} marks={{ a: { kind: "changed", delta: 2 }, c: { kind: "changed", delta: -3 } }} />);
      fireEvent.click(screen.getByRole("button", { name: "Files" }));
      expect(screen.getByRole("columnheader", { name: "Files" })).toHaveAttribute("aria-sort", "descending");
      fireEvent.click(screen.getByRole("button", { name: "Change since previous scan" }));
      expect(screen.getByRole("columnheader", { name: /^Change/ })).toHaveAttribute("aria-sort", "ascending");
      expect(screen.getAllByRole("row").slice(1).map((r) => (r.textContent ?? "").includes("Drop"))).toEqual([true, false]);
    });

    it("a long name's badges wrap under it at every width instead of widening the table", () => {
      render(<ComponentsTable repoId="r1" rows={[{ ...removed, displayName: "PharmacyLicenseLogoExample" }]} marks={{ gone: { kind: "removed" } }} />);
      const NAME_ROW = "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5";
      expect(screen.getByText("Removed").parentElement?.className).toBe(NAME_ROW);
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
