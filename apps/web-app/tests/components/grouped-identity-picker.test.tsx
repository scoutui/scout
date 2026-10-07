// @vitest-environment jsdom
import { useCallback, useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { CohortSelector, GovernanceRecord } from "@scoutui/web-shared";
import { cohortKey } from "@scoutui/web-shared/client";
import { GroupedIdentityPicker, type IdentityPick } from "@/components/governance/grouped-identity-picker";
import type { GovernanceTarget } from "@scoutui/web-shared";
import type { PickableComponent } from "@/lib/chart-builder-series";
import { searchSeries, searchTargets } from "@/lib/identity-search";

const sources: GovernanceTarget[] = [
  { packageName: "@example/old-ui", occurrences: 70 },
  { packageName: "@example/old-ui", exportName: "Button", occurrences: 60 },
  { packageName: "@example/old-ui", exportName: "Card", occurrences: 10 },
  { packageName: "@example/new-ui", occurrences: 8 },
  { packageName: "@example/new-ui", exportName: "Button", occurrences: 8 },
];
const recorded: GovernanceRecord = {
  id: "r1", grain: "component", targetPackage: "@example/old-ui", targetExport: "Button",
  disposition: { kind: "retired", reason: "replaced" }, createdAt: "t", updatedAt: "t",
};

function Field(props: { sources?: GovernanceTarget[]; records?: GovernanceRecord[]; value?: IdentityPick | null; scope?: string | null; onSelect?: (p: IdentityPick) => void; onScopeChange?: (s: string | null) => void }) {
  const [scope, setScope] = useState(props.scope ?? null);
  const list = props.sources ?? sources;
  const records = props.records ?? [];
  const search = useCallback(
    (query: string, scope: string | null) => searchTargets({ mode: "source", sources: list, query, scope, records }),
    [list, records],
  );
  return (
    <>
      <label id="source-label" htmlFor="source">Package or component</label>
      <GroupedIdentityPicker
        id="source" labelId="source-label" search={search}
        value={props.value ?? null} onSelect={props.onSelect ?? (() => {})}
        scope={scope} onScopeChange={(s) => { setScope(s); props.onScopeChange?.(s); }}
        placeholder="Search packages and components"
        emptyText="Nothing scanned yet"
      />
    </>
  );
}

const input = () => screen.getByRole("combobox", { name: "Package or component" });
const active = () => document.getElementById(input().getAttribute("aria-activedescendant") ?? "") as HTMLElement;

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

const icons: GovernanceTarget[] = [
  { packageName: "@example/glyphs", occurrences: 60 },
  ...Array.from({ length: 60 }, (_, i) => ({ packageName: "@example/glyphs", exportName: `Icon${i}`, occurrences: 1 })),
];

describe("GroupedIdentityPicker", () => {
  it.each([
    ["nothing to search", [], "", "Nothing scanned yet", 0],
    ["a search that matches nothing", sources, "zzz", "No matches", 0],
    ["more components than the list shows", icons, "icon", "Showing 50 of 60. Type to narrow the list.", 50],
    ["a search the list shows in full", sources, "button", null, 2],
  ] as const)("says what the list can't show in one line that isn't an option: %s", (_, list, query, text, options) => {
    render(<Field sources={[...list]} />);
    fireEvent.click(input());
    if (query) fireEvent.change(input(), { target: { value: query } });
    if (text === null) expect(screen.getByRole("status")).toBeEmptyDOMElement();
    else expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(screen.queryAllByRole("option")).toHaveLength(options);
  });

  it("points to each search's first pick, reaches an already-recorded option with the arrows, and Enter there picks nothing", () => {
    const onSelect = vi.fn();
    render(<Field records={[recorded]} onSelect={onSelect} />);
    fireEvent.change(input(), { target: { value: "card" } });
    expect(active().textContent).toMatch(/^Card/);
    const cardOption = input().getAttribute("aria-activedescendant");
    fireEvent.change(input(), { target: { value: "button" } });
    expect(input().getAttribute("aria-activedescendant")).not.toBe(cardOption);
    expect(active()).toHaveAccessibleName(/@example\s*\/new-ui/);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(active()).toHaveAttribute("aria-disabled", "true");
    expect(active()).toHaveAccessibleName(/Button.*@example\s*\/old-ui.*Already recorded/);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox", { name: "Package or component" })).toBeInTheDocument();
  });

  it("narrows to a package with Enter on its row, and Backspace on an empty search widens it again", () => {
    const onScopeChange = vi.fn();
    const onSelect = vi.fn();
    render(<Field onScopeChange={onScopeChange} onSelect={onSelect} />);
    fireEvent.change(input(), { target: { value: "old" } });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(active()).toHaveAccessibleName(/^@example\s*\/old-ui/);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onScopeChange).toHaveBeenLastCalledWith("@example/old-ui");
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: /All of\s*@example\s*\/old-ui/ })).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(onScopeChange).toHaveBeenLastCalledWith(null);
  });

  it("narrows to a package offered for the names it holds and keeps searching for them", () => {
    const onScopeChange = vi.fn();
    const local: GovernanceTarget[] = [
      { packageName: "@example/ui", occurrences: 12, local: true },
      { packageName: "@example/ui", exportName: "Button", occurrences: 9, local: true },
      { packageName: "@example/ui", exportName: "Card", occurrences: 3, local: true },
    ];
    render(<Field sources={local} onScopeChange={onScopeChange} />);
    fireEvent.change(input(), { target: { value: "ui button" } });
    expect(screen.getByRole("option")).toHaveAccessibleName(/@example\s*\/ui.*1 match/);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onScopeChange).toHaveBeenLastCalledWith("@example/ui");
    expect(input()).toHaveValue("button");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringMatching(/^Button/)]);
  });

  it("picks the first component on Enter, never the whole package", () => {
    const onSelect = vi.fn();
    render(<Field scope="@example/old-ui" onSelect={onSelect} />);
    fireEvent.click(input());
    const listbox = screen.getByRole("listbox", { name: "Package or component" });
    expect(input()).toHaveAttribute("aria-controls", listbox.id);
    expect(active()).toHaveAttribute("aria-selected", "true");
    expect(within(listbox).getAllByRole("option")[0]).toHaveAccessibleName(/All of\s*@example\s*\/old-ui/);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith({ packageName: "@example/old-ui", exportName: "Button" });
  });

  it("keeps the value when closed without a pick, selected so the next key starts a new search", () => {
    const onSelect = vi.fn();
    render(<Field value={{ packageName: "@example/old-ui", exportName: "Card" }} onSelect={onSelect} />);
    input().focus();
    fireEvent.click(input());
    fireEvent.change(input(), { target: { value: "but" } });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(input()).toHaveValue("Card · @example/old-ui");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    const field = input() as HTMLInputElement;
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, "Card · @example/old-ui".length]);
    fireEvent.click(input());
    fireEvent.change(input(), { target: { value: "but" } });
    fireEvent.blur(input());
    expect(onSelect).not.toHaveBeenCalled();
    expect(input()).toHaveValue("Card · @example/old-ui");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("lets Tab leave an untouched list and Shift+Tab leave any list, and narrows on Tab once the arrows reach a package row", () => {
    const onScopeChange = vi.fn();
    render(<Field onScopeChange={onScopeChange} />);
    fireEvent.click(input());
    expect(active()).toHaveAccessibleName(/^@example\s*\/old-ui/);
    expect(fireEvent.keyDown(input(), { key: "Tab" })).toBe(true);
    expect(onScopeChange).not.toHaveBeenCalled();
    fireEvent.blur(input());
    fireEvent.click(input());
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(fireEvent.keyDown(input(), { key: "Tab", shiftKey: true })).toBe(true);
    expect(onScopeChange).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(input(), { key: "Tab" })).toBe(false);
    expect(onScopeChange).toHaveBeenLastCalledWith("@example/new-ui");
  });

  it("opens the list from a press on the chevron", () => {
    render(<Field />);
    fireEvent.mouseDown(input().parentElement?.querySelector(".lucide-chevrons-up-down") as Element);
    expect(screen.getByRole("listbox", { name: "Package or component" })).toBeInTheDocument();
  });
});

const charted: PickableComponent[] = [
  { componentId: "c1", displayName: "Button", packageName: "@example/old-ui", disambiguator: null, deprecated: false, occurrences: 60, local: false },
  { componentId: "c2", displayName: "Button", packageName: "@example/new-ui", disambiguator: "src/button/index.ts", deprecated: false, occurrences: 8, local: false },
  { componentId: "c3", displayName: "Button", packageName: "@example/new-ui", disambiguator: "src/legacy/button.ts", deprecated: false, occurrences: 3, local: false },
];

function SeriesField({ onSelect }: { onSelect: (sel: CohortSelector) => void }) {
  const [scope, setScope] = useState<string | null>(null);
  const [added, setAdded] = useState<CohortSelector[]>([]);
  const search = useCallback(
    (query: string, scope: string | null) =>
      searchSeries({ tags: [], components: charted, packages: ["@example/old-ui", "@example/new-ui"], query, scope, added: new Set(added.map(cohortKey)) }),
    [added],
  );
  return (
    <>
      <label id="series-label" htmlFor="series">Add a series</label>
      <GroupedIdentityPicker
        id="series" labelId="series-label" search={search} multiple
        onSelect={(sel) => {
          onSelect(sel);
          setAdded((prev) => (prev.some((p) => cohortKey(p) === cohortKey(sel)) ? prev.filter((p) => cohortKey(p) !== cohortKey(sel)) : [...prev, sel]));
        }}
        scope={scope} onScopeChange={setScope}
        placeholder="Add a series"
        emptyText="Nothing scanned yet"
      />
    </>
  );
}

describe("GroupedIdentityPicker adding several", () => {
  const seriesInput = () => screen.getByRole("combobox", { name: "Add a series" });
  const option = (name: RegExp) => screen.getByRole("option", { name });

  it("stays open with the search while it adds, marks each added row, and hands back an added row to remove it", () => {
    const onSelect = vi.fn();
    render(<SeriesField onSelect={onSelect} />);
    fireEvent.change(seriesInput(), { target: { value: "button" } });
    fireEvent.keyDown(seriesInput(), { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "component", componentId: "c1" });
    expect(seriesInput()).toHaveValue("button");
    expect(screen.getByRole("listbox", { name: "Add a series" })).toHaveAttribute("aria-multiselectable", "true");
    fireEvent.click(option(/legacy\/button\.ts/));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "component", componentId: "c3" });
    expect(screen.getAllByRole("option").map((o) => o.getAttribute("aria-selected"))).toEqual(["true", "false", "true"]);
    fireEvent.click(option(/legacy\/button\.ts/));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "component", componentId: "c3" });
    expect(screen.getAllByRole("option").map((o) => o.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
  });

  it("names a component's whole package to screen readers, not the shortened form", () => {
    render(<SeriesField onSelect={() => {}} />);
    fireEvent.change(seriesInput(), { target: { value: "button" } });
    expect(screen.getAllByRole("option")[0]).toHaveAccessibleName(/^Button\s*@example\s*\/old-ui$/);
  });
});
