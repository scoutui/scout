// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FilterBar } from "@/components/repos/filter-bar";
import { PackageFilterBar } from "@/components/packages/package-filter-bar";
import { emptyFacets, isFiltering, type FacetOptions, type FacetState } from "@/lib/component-facets";
import { emptyPackageFacets } from "@/lib/package-facets";

const options: FacetOptions = {
  origin: { external: 3, local: 1 },
  kinds: [
    { value: "react", count: 3 },
    { value: "wc", count: 1 },
  ],
  packages: [{ value: "@x/lib", count: 3 }],
  tags: [{ value: "icons", color: "#0f766e", count: 3 }],
  deprecatedCount: 2,
  changedCount: null,
  deprecatedMax: 2,
  changedMax: 0,
};

function renderBar(opts: FacetOptions = options, facets: FacetState = emptyFacets(), deprecatedTotal = 2) {
  const onChange = vi.fn();
  render(
    <FilterBar
      facets={facets}
      onChange={onChange}
      options={opts}
      resultCount={4}
      total={4}
      deprecatedTotal={deprecatedTotal}
      diffShown={null}
      filtering={isFiltering(facets)}
    />,
  );
  return onChange;
}

/** Matches the count line: its <span> holds the whole sentence, and child spans
 *  hold the numbers. */
const sentence = (t: string) => (_: string, el: Element | null) => el?.tagName === "SPAN" && el.textContent === t;

/** Open the `+ Filter` popover and step into one facet. Base UI popovers open
 *  under fireEvent.click in jsdom (governance-manager.test.tsx does the same). */
async function openFacet(label: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: /^filter/i }));
  fireEvent.click(await screen.findByRole("button", { name: label }));
}

type TagOption = { value: string; color: string; count: number };

/** Each page's bar, set up through its own options so one case runs on both. */
const PAGES: {
  page: string;
  renderTags: (tags: TagOption[], selected?: string[]) => void;
  /** The facet that leaves the menu with one value left: counts for its first
   *  two values, and whether the first is selected. */
  oneValueFacet: RegExp;
  renderOneValueFacet: (counts: [number, number], selected: boolean) => void;
}[] = [
  {
    page: "repo page",
    renderTags: (tags, selected = []) => renderBar({ ...options, tags }, { ...emptyFacets(), tags: selected }),
    oneValueFacet: /^framework/i,
    renderOneValueFacet: ([react, vue], selected) =>
      renderBar(
        { ...options, kinds: [{ value: "react", count: react }, { value: "vue", count: vue }] },
        { ...emptyFacets(), kinds: selected ? ["react"] : [] },
      ),
  },
  {
    page: "Packages page",
    renderTags: (tags, selected = []) =>
      renderPackageBar({ tags }, { tags: selected }),
    oneValueFacet: /^versions/i,
    renderOneValueFacet: ([multi, single], selected) =>
      renderPackageBar({ versions: { multi, single, unversioned: 0 } }, { versions: selected ? "multi" : null }),
  },
];

function renderPackageBar(
  opts: Partial<React.ComponentProps<typeof PackageFilterBar>["options"]>,
  facets: Partial<React.ComponentProps<typeof PackageFilterBar>["facets"]>,
) {
  render(
    <PackageFilterBar
      facets={{ ...emptyPackageFacets(), ...facets }}
      onChange={vi.fn()}
      options={{
        tags: [{ value: "icons", color: "#0f766e", count: 3 }],
        versions: { multi: 1, single: 2, unversioned: 1 },
        deprecatedCount: 0,
        deprecatedMax: 0,
        total: 4,
        ...opts,
      }}
      resultCount={4}
    />,
  );
}

describe.each(PAGES)("the filter bar on the $page", ({ renderTags, oneValueFacet, renderOneValueFacet }) => {
  it("marks an option pressed or not, and hides its checkbox from screen readers", async () => {
    renderTags([{ value: "core", color: "#0f766e", count: 3 }]);
    await openFacet(/^tag/i);
    const option = await screen.findByRole("button", { name: /^core/ });
    expect(option).toHaveAttribute("aria-pressed", "false");
    expect(within(option).queryByRole("checkbox")).toBeNull();
  });

  it("draws a palette tag colour through its theme token", async () => {
    renderTags([{ value: "core", color: "#009598", count: 3 }]);
    await openFacet(/^tag/i);
    const option = await screen.findByRole("button", { name: /^core/ });
    expect(option.querySelector("span[style]")?.getAttribute("style")).toContain("var(--viz-primary)");
  });

  it("hides a tag the other filters leave at zero, and keeps a selected one visible at 0", async () => {
    renderTags(
      [
        { value: "core", color: "#0f766e", count: 3 },
        { value: "forms", color: "#0f766e", count: 0 },
        { value: "picked", color: "#0f766e", count: 0 },
      ],
      ["picked"],
    );
    await openFacet(/^tag/i);
    expect((await screen.findByRole("button", { name: /^core/ })).textContent).toBe("core3");
    expect(screen.queryByRole("button", { name: /^forms/ })).toBeNull();
    const picked = screen.getByRole("button", { name: /^picked/ });
    expect(picked.textContent).toBe("picked0");
    expect(picked).toHaveAttribute("aria-pressed", "true");
  });

  it("says None match the other filters when every tag is at zero, distinct from an estate with no tags", async () => {
    renderTags([{ value: "icons", color: "#0f766e", count: 0 }]);
    await openFacet(/^tag/i);
    expect(await screen.findByText("None match the other filters.")).toBeInTheDocument();
    expect(screen.queryByText(/No library tags/)).toBeNull();
  });

  it("points an estate with no tags at the Tags section of Governance instead of saying No matches", async () => {
    renderTags([]);
    await openFacet(/^tag/i);
    expect(await screen.findByText(/No library tags yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add one in Governance/i })).toHaveAttribute("href", "/governance#tags");
    expect(screen.queryByText("No matches.")).toBeNull();
  });

  it("sets tag names in mono in the Tag list", async () => {
    renderTags([{ value: "core", color: "#0f766e", count: 3 }]);
    await openFacet(/^tag/i);
    const option = await screen.findByRole("button", { name: /^core/ });
    expect(within(option).getByText("core").className).toMatch(/(^|\s)font-mono(\s|$)/);
  });

  it("still says No matches when a tag search misses", async () => {
    // >8 items so the search input renders.
    renderTags(Array.from({ length: 9 }, (_, i) => ({ value: `lib-${i}`, color: "#0f766e", count: 1 })));
    await openFacet(/^tag/i);
    fireEvent.change(await screen.findByPlaceholderText("Search tags…"), { target: { value: "zzz" } });
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });

  it("lists the one-value facet while the other filters leave it two values", async () => {
    renderOneValueFacet([3, 1], false);
    fireEvent.click(screen.getByRole("button", { name: /^filter/i }));
    expect(await screen.findByRole("button", { name: oneValueFacet })).toBeInTheDocument();
  });

  it("drops the one-value facet when the other filters leave it one value", async () => {
    renderOneValueFacet([3, 0], false);
    fireEvent.click(screen.getByRole("button", { name: /^filter/i }));
    await screen.findByRole("button", { name: /^tag/i });
    expect(screen.queryByRole("button", { name: oneValueFacet })).toBeNull();
  });

  it("keeps the one-value facet while a value is selected, even the only one left", async () => {
    renderOneValueFacet([4, 0], true);
    fireEvent.click(screen.getByRole("button", { name: /^filter/i }));
    expect(await screen.findByRole("button", { name: oneValueFacet })).toBeInTheDocument();
  });
});

describe("FilterBar status chips", () => {
  it("gives the deprecated chip the same keyboard focus ring as the Filter trigger", () => {
    renderBar();
    const chip = screen.getByRole("button", { name: /deprecated/i });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip.className).toMatch(/focus-visible:ring-3/);
    expect(chip.className).toMatch(/focus-visible:ring-ring\//);
  });

  it("a pressed status chip the other filters leave at 0 stays, so it can be unpressed", () => {
    const onChange = renderBar({ ...options, deprecatedCount: 0, changedCount: 0 }, { ...emptyFacets(), deprecated: true, changed: true });
    const deprecated = screen.getByRole("button", { name: /^deprecated/ });
    expect(deprecated.textContent).toBe("deprecated0");
    expect(deprecated).toHaveAttribute("aria-pressed", "true");
    const since = screen.getByRole("button", { name: /^since previous scan/ });
    expect(since.textContent).toBe("since previous scan0");
    fireEvent.click(since);
    expect(onChange).toHaveBeenCalledWith({ ...emptyFacets(), deprecated: true, changed: false });
  });

  it("the deprecated chip is absent when the table has no deprecated components at all", () => {
    renderBar({ ...options, deprecatedMax: 0, deprecatedCount: 0 });
    expect(screen.queryByRole("button", { name: /^deprecated/ })).toBeNull();
  });

  it("the deprecated chip renders pressed and enabled under a pasted ?deprecated=true, even with no deprecated components, so it can be unpressed", () => {
    renderBar({ ...options, deprecatedMax: 0, deprecatedCount: 0 }, { ...emptyFacets(), deprecated: true });
    const chip = screen.getByRole("button", { name: /^deprecated/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).not.toBeDisabled();
  });

  it("the deprecated chip stays in place, disabled, when the other filters leave it no rows", () => {
    renderBar({ ...options, deprecatedMax: 2, deprecatedCount: 0 }, { ...emptyFacets(), tags: ["icons"] });
    const chip = screen.getByRole("button", { name: /^deprecated/ });
    expect(chip.textContent).toBe("deprecated0 of 2");
    expect(chip).toBeDisabled();
  });

  // `deprecatedTotal` is 2 in every row. A null `changedCount` means there is no changed view, so `changed:true` changes nothing.
  it.each([
    { when: "no other filter is on", facets: {}, changedCount: null, count: 2, text: "deprecated2" },
    { when: "a tag narrows the table", facets: { tags: ["icons"] }, changedCount: null, count: 1, text: "deprecated1 of 2" },
    { when: "search text narrows the table", facets: { text: "but" }, changedCount: null, count: 1, text: "deprecated1 of 2" },
    { when: "only a pasted deprecated:false is on", facets: { deprecated: false }, changedCount: null, count: 2, text: "deprecated2" },
    { when: "only its own deprecated:true is on", facets: { deprecated: true }, changedCount: null, count: 2, text: "deprecated2" },
    { when: "a tag is on and changed:true is inert", facets: { changed: true, tags: ["icons"] }, changedCount: null, count: 1, text: "deprecated1 of 2" },
  ] satisfies { when: string; facets: Partial<FacetState>; changedCount: number | null; count: number; text: string }[])(
    "when $when, the deprecated chip reads $text",
    ({ facets, changedCount, count, text }) => {
      renderBar({ ...options, deprecatedCount: count, changedCount }, { ...emptyFacets(), ...facets }, 2);
      expect(screen.getByRole("button", { name: /^deprecated/ }).textContent).toBe(text);
    },
  );
});

describe("PackageFilterBar deprecated chip and count line", () => {
  it("has no deprecated chip when no package has deprecated components in use", () => {
    renderPackageBar({ deprecatedMax: 0, deprecatedCount: 0 }, {});
    expect(screen.queryByRole("button", { name: /^deprecated/ })).toBeNull();
  });

  // `deprecatedMax` is 3 in every row.
  it.each([
    { when: "no filter is on", facets: {}, count: 3, text: "deprecated3" },
    { when: "a tag narrows the list", facets: { tags: ["icons"] }, count: 1, text: "deprecated1 of 3" },
    { when: "only a pasted deprecated:false is on", facets: { deprecated: false }, count: 3, text: "deprecated3" },
  ] satisfies { when: string; facets: Partial<React.ComponentProps<typeof PackageFilterBar>["facets"]>; count: number; text: string }[])(
    "when $when, the deprecated chip reads $text",
    ({ facets, count, text }) => {
      renderPackageBar({ deprecatedMax: 3, deprecatedCount: count }, facets);
      expect(screen.getByRole("button", { name: /^deprecated/ }).textContent).toBe(text);
    },
  );

  // The bar shows 4 rows in every case.
  it.each([
    { when: "unfiltered", total: 162, facets: {}, text: "162 packages" },
    { when: "unfiltered with one package", total: 1, facets: {}, text: "1 package" },
    { when: "a tag narrows the list", total: 162, facets: { tags: ["icons"] }, text: "4 of 162 packages" },
  ])("$when, the count reads $text", ({ total, facets, text }) => {
    renderPackageBar({ total }, facets);
    expect(screen.getByText(sentence(text))).toBeInTheDocument();
  });
});

describe("FilterBar pills", () => {
  it("names a package pill's field package, and each remove button by its pill's field and value", () => {
    const onChange = renderBar(options, { ...emptyFacets(), packages: ["@x/lib"], tags: ["icons"] });
    expect(screen.getByText("package")).toBeInTheDocument();
    expect(screen.queryByText("pkg")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove package @x/lib" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove tag icons" }));
    expect(onChange).toHaveBeenCalledWith({ ...emptyFacets(), packages: ["@x/lib"], tags: [] });
  });
});

describe("FilterBar occurrence vocabulary", () => {
  it("labels the active occurrence pill with the word occurrences", () => {
    renderBar(options, { ...emptyFacets(), occurrences: { op: ">=", value: 100 } });
    expect(screen.getByText("occurrences")).toBeInTheDocument();
    expect(screen.getByText("≥ 100")).toBeInTheDocument();
    expect(screen.queryByText(/\buses\b|\busages\b/)).toBeNull();
  });

  it("names the facet Occurrences in the filter menu", async () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /^filter/i }));
    expect(await screen.findByRole("button", { name: /^occurrences/i })).toBeInTheDocument();
  });
});

describe("FilterBar since-previous-scan chip", () => {
  const withChanged: FacetOptions = { ...options, changedCount: 29 };

  it("follows the deprecated chip with icon, word and count, and toggles changed:true", () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        facets={emptyFacets()}
        onChange={onChange}
        options={withChanged}
        resultCount={4}
        total={4}
        deprecatedTotal={2}
        diffShown={null}
        filtering={false}
      />,
    );
    const chip = screen.getByRole("button", { name: /^since previous scan/ });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip.textContent).toBe("since previous scan29");
    expect(chip.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const deprecated = screen.getByRole("button", { name: /deprecated/i });
    expect(deprecated.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith({ ...emptyFacets(), changed: true });
  });

  it("pressed, it takes the neutral selected state and the deprecated chip's focus ring, and adds no pill", () => {
    renderBar(withChanged, { ...emptyFacets(), changed: true });
    const chip = screen.getByRole("button", { name: /^since previous scan/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip.className).toMatch(/(^|\s)selected(\s|$)/);
    expect(chip.className).not.toMatch(/accent-soft/);
    // Pressed keeps the idle weight, so toggling never widens the chip.
    expect(chip.className).not.toMatch(/(^|\s)font-medium(\s|$)/);
    expect(chip.className).not.toMatch(/destructive/);
    expect(chip.className).toMatch(/focus-visible:ring-3/);
    expect(chip.className).toMatch(/focus-visible:ring-ring\//);
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(screen.queryByText("Clear all")).toBeNull();
  });

  it("renders nothing when there is no changed view (no diff, or nothing moved), even under a pasted ?changed=true", () => {
    renderBar(options, { ...emptyFacets(), changed: true }); // options.changedCount is null
    expect(screen.queryByRole("button", { name: /since previous scan/ })).toBeNull();
  });

  it("stays in place at 0, disabled and unpressed, when the other filters leave it no rows", () => {
    renderBar({ ...options, changedCount: 0 });
    const chip = screen.getByRole("button", { name: /^since previous scan/ });
    expect(chip.textContent).toBe("since previous scan0");
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });
});

describe("FilterBar result count in the changed view", () => {
  const renderCount = (
    diffShown: { total: number; added: number; removed: number; changed: number } | null,
    { filtering, resultCount }: { filtering: boolean; resultCount: number },
  ) =>
    render(
      <FilterBar
        facets={{ ...emptyFacets(), changed: diffShown !== null, tags: filtering ? ["primitives"] : [] }}
        onChange={vi.fn()}
        options={{ ...options, changedCount: resultCount }}
        resultCount={resultCount}
        total={1879}
        deprecatedTotal={2}
        diffShown={diffShown}
        filtering={filtering}
      />,
    );
  const filtered = { total: 29, added: 0, removed: 2, changed: 10 };

  it("unfiltered, reads the view's size: `29 moved`, never repeating the masthead's breakdown", () => {
    renderCount({ total: 29, added: 3, removed: 8, changed: 18 }, { filtering: false, resultCount: 29 });
    expect(screen.getByText(sentence("29 moved"))).toBeInTheDocument();
    expect(screen.queryByText(/removed/)).toBeNull();
  });

  it("filtered, anchors the shown rows to the view's size, then their breakdown with zero parts omitted", () => {
    renderCount(filtered, { filtering: true, resultCount: 12 });
    const count = screen.getByText(sentence("12 of 29 moved · 2 removed · 10 changed"));
    expect(screen.queryByText(/added/)).toBeNull();
    // The shown count and the breakdown's numbers take the ink; the anchor stays muted.
    expect(within(count).getByText("12").className).toBe("font-medium text-foreground");
    expect(within(count).getByText("10").className).toBe("font-medium text-foreground");
    expect(within(count).queryByText("29")).toBeNull();
  });

  it("outside the changed view the count is N of M components", () => {
    renderCount(null, { filtering: true, resultCount: 21 });
    expect(screen.getByText(sentence("21 of 1,879 components"))).toBeInTheDocument();
    expect(screen.queryByText(/moved/)).toBeNull();
  });

  it("is not hidden below sm: phones get the breakdown, on its own line in the wrapping row", () => {
    renderCount(filtered, { filtering: true, resultCount: 12 });
    const count = screen.getByText(sentence("12 of 29 moved · 2 removed · 10 changed"));
    expect(count.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(count.className).not.toMatch(/sm:inline/);
    expect(count.className).toMatch(/(^|\s)basis-full(\s|$)/);
    expect(count.className).toMatch(/sm:basis-auto/);
  });

  it("from sm up the search is capped and the count takes the free gap, so a count change cannot move the controls", () => {
    renderCount(filtered, { filtering: true, resultCount: 12 });
    const search = screen.getByRole("textbox", { name: "Search components by name" }).parentElement as HTMLElement;
    expect(search.className).toBe("relative min-w-0 grow basis-full sm:basis-0 sm:max-w-xs xl:max-w-md");
    expect(screen.getByText(sentence("12 of 29 moved · 2 removed · 10 changed")).className).toMatch(/(^|\s)sm:ml-auto(\s|$)/);
  });
});
