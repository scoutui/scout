import { describe, expect, it } from "vitest";
import type { GovernanceRecord } from "@scoutui/web-shared";
import type { GovernanceTarget } from "@scoutui/web-shared";
import type { CohortSelector } from "@scoutui/web-shared";
import { cohortKey } from "@scoutui/web-shared/client";
import type { PickableComponent } from "@/lib/chart-builder-series";
import { MAX_COMPONENT_ROWS, type SearchGroup, type SearchInput, type SearchRow, type SeriesSearchInput, groupSeries, searchSeries, searchTargets } from "@/lib/identity-search";

const target = (packageName: string, exportName: string, occurrences: number): GovernanceTarget => ({ packageName, exportName, occurrences });
const pkg = (packageName: string, occurrences: number): GovernanceTarget => ({ packageName, occurrences });

const record = (id: string, targetPackage: string, targetExport: string | null): GovernanceRecord => ({
  id, grain: targetExport === null ? "package" : "component", targetPackage, targetExport,
  disposition: { kind: "retired", reason: "replaced" }, createdAt: "t", updatedAt: "t",
});

const search = (over: Partial<SearchInput>) =>
  searchTargets({ mode: "source", sources: [], query: "", scope: null, records: [], ...over });

const label = (row: SearchRow<unknown>) =>
  row.kind === "tag" ? `tag ${row.label}`
    : row.kind === "local" ? row.label
      : `${row.exportName} ${row.packageName}${row.refusal ? ` (${row.refusal})` : ""}`;
// Each package as "name matched/components (why it can't be picked whole): its rows", with "+" when it offers the rest.
const groupLabel = (g: SearchGroup<unknown>) =>
  `${g.packageName} ${g.matched ?? "-"}/${g.components}${g.more ? "+" : ""}${g.refusal ? ` (${g.refusal})` : ""}: ${g.rows.map((r) => `${r.exportName}${r.refusal ? ` (${r.refusal})` : ""}`).join(", ")}`;
const grouped = (over: Partial<SearchInput>) => search(over).groups.map(groupLabel);
const listed = (over: Partial<SearchInput>) => search(over).rows.map(label);

const tiers = [
  pkg("@example/kit", 271), pkg("@example/tabs", 80),
  target("@example/kit", "Stable", 90),
  target("@example/tabs", "Panel", 80),
  target("@example/kit", "TextAreaBox", 70),
  target("@example/kit", "DataTable", 60),
  target("@example/kit", "Table", 50),
  target("@example/kit", "Tab", 1),
];

const estate = [
  pkg("@example/old-ui", 120), pkg("@example/new-ui", 26), pkg("@example/legacy-kit", 20), pkg("@example/unused", 0),
  target("@example/old-ui", "Button", 60), target("@example/old-ui", "SkeletonText", 30), target("@example/old-ui", "DialogContent", 12),
  target("@example/old-ui", "Table.Cell", 12), target("@example/old-ui", "ButtonGroup", 6),
  target("@example/new-ui", "Button", 8), target("@example/new-ui", "Skeleton", 5), target("@example/new-ui", "CardPanel", 4),
  target("@example/new-ui", "DialogPanel", 2), target("@example/new-ui", "DialogPopup", 2), target("@example/new-ui", "AlertDialogPopup", 1),
  target("@example/new-ui", "Avatar", 4),
  target("@example/legacy-kit", "Button", 20),
  target("@example/unused", "Gone", 0),
];

describe("searchTargets: ranking", () => {
  it("ranks by where the term matches before how often a component is used, and lists a package by its best match", () => {
    expect(grouped({ sources: tiers, query: "tab" })).toEqual([
      "@example/kit 5/5: Tab, Table, DataTable, TextAreaBox, Stable",
      "@example/tabs -/1: Panel",
    ]);
  });

  it("lists packages that match as well by use, then by name", () => {
    const sources = [target("@example/b", "Button", 9), target("@example/a", "Button", 5), target("@example/c", "Button", 9)];
    expect(search({ sources, query: "button" }).groups.map((g) => g.packageName)).toEqual(["@example/b", "@example/c", "@example/a"]);
  });

  it("needs every term to match and ranks by the weakest one", () => {
    expect(grouped({ sources: tiers, query: "kit tab" })).toEqual(["@example/kit 5/5: TextAreaBox, DataTable, Table, Tab, Stable"]);
  });

  it("marks the matched parts of the name", () => {
    const rows = (query: string) => search({ sources: estate, query }).groups.flatMap((g) => g.rows);
    expect(rows("dp").find((r) => r.exportName === "DialogPopup")).toMatchObject({ matched: [[0, 1], [6, 7]] });
    expect(rows("dia dialog").find((r) => r.exportName === "DialogPanel")).toMatchObject({ matched: [[0, 6]] });
  });

  it("offers a target only older scans have, after the used ones", () => {
    expect(search({ sources: estate }).groups.at(-1)?.packageName).toBe("@example/unused");
    expect(grouped({ sources: estate, query: "gone" })).toEqual(["@example/unused 1/1: Gone"]);
  });
});

describe("searchTargets: packages", () => {
  it("lists every package by use when nothing is typed, closed", () => {
    expect(grouped({ sources: estate })).toEqual([
      "@example/old-ui -/5: ", "@example/new-ui -/7: ", "@example/legacy-kit -/1: ", "@example/unused -/1: ",
    ]);
  });

  it("opens a package its name matches on its five most used components, and lists one package's components in full", () => {
    expect(grouped({ sources: estate, query: "new" })).toEqual(["@example/new-ui -/7+: Button, Skeleton, Avatar, CardPanel, DialogPanel"]);
    expect(listed({ sources: estate, scope: "@example/new-ui" })).toEqual([
      "Button @example/new-ui", "Skeleton @example/new-ui", "Avatar @example/new-ui", "CardPanel @example/new-ui",
      "DialogPanel @example/new-ui", "DialogPopup @example/new-ui", "AlertDialogPopup @example/new-ui",
    ]);
  });

  it("shows at most 50 components across every package, and all of them in one package's list", () => {
    const sources = [pkg("@example/glyphs", 60), ...Array.from({ length: 60 }, (_, i) => target("@example/glyphs", `Icon${i}`, 1))];
    const result = search({ sources, query: "icon" });
    expect(result.groups.flatMap((g) => g.rows)).toHaveLength(MAX_COMPONENT_ROWS);
    expect(result.total).toBe(60);
    expect(search({ sources, scope: "@example/glyphs" }).rows).toHaveLength(60);
  });

  it("lists packages defined in a scanned repo by use among the others, with their matching components under them", () => {
    const local = (t: GovernanceTarget): GovernanceTarget => ({ ...t, local: true });
    const monorepo = [
      pkg("@example/legacy-kit", 20), target("@example/legacy-kit", "Button", 20),
      local(pkg("@example/app", 500)), local(target("@example/app", "Page", 300)), local(target("@example/app", "Header", 200)),
      local(pkg("@example/ui", 90)), local(target("@example/ui", "Button", 60)), local(target("@example/ui", "ButtonGroup", 30)),
    ];
    expect(search({ sources: monorepo }).groups.map((g) => g.packageName)).toEqual(["@example/app", "@example/ui", "@example/legacy-kit"]);
    const result = search({ sources: monorepo, query: "button" });
    expect(result.groups.map(groupLabel)).toEqual(["@example/ui 2/2: Button, ButtonGroup", "@example/legacy-kit 1/1: Button"]);
    expect(result.groups.map((g) => g.rows.map((r) => r.local))).toEqual([[true, true], [false]]);
  });
});

describe("searchTargets: refusals", () => {
  const records = [
    record("button", "@example/old-ui", "Button"),
    record("dialog", "@example/old-ui", "DialogContent"),
    record("kit", "@example/legacy-kit", null),
  ];

  it.each([
    ["the same component", "button", "@example/old-ui 2/5 (2 components already recorded): Button (Already recorded), ButtonGroup"],
    ["a component of a package with a record", "button", "@example/legacy-kit 1/1 (Already recorded): Button (Whole package recorded)"],
    ["a package with a record", "", "@example/legacy-kit -/1 (Already recorded): "],
    ["a package with component records", "", "@example/old-ui -/5 (2 components already recorded): "],
  ])("refuses %s", (_, query, expected) => {
    expect(grouped({ sources: estate, records, query })).toContain(expected);
  });

  it("says one component when one is recorded", () => {
    expect(search({ sources: estate, records: [records[0] as GovernanceRecord] }).groups[0]?.refusal).toBe("1 component already recorded");
  });

  it("puts refused rows after the others that match as well", () => {
    expect(listed({ sources: estate, records, scope: "@example/old-ui" })).toEqual([
      "SkeletonText @example/old-ui", "Table.Cell @example/old-ui", "ButtonGroup @example/old-ui",
      "Button @example/old-ui (Already recorded)", "DialogContent @example/old-ui (Already recorded)",
    ]);
  });

  it("keeps the edited record's own target pickable", () => {
    expect(grouped({ sources: estate, records, editingId: "button", query: "button" })).toContain("@example/old-ui 2/5 (1 component already recorded): Button, ButtonGroup");
  });

  it("refuses nothing in a replacement, leaves out the record's own component, and can't pick its own whole package", () => {
    const successor = (exclude: { packageName: string; exportName?: string }) => ({ mode: "successor" as const, sources: estate, records, exclude });
    const component = successor({ packageName: "@example/old-ui", exportName: "SkeletonText" });
    expect(search(component).groups.map((g) => g.refusal)).toEqual([null, null, null, null]);
    expect(listed({ ...component, scope: "@example/old-ui" })).toEqual([
      "Button @example/old-ui", "DialogContent @example/old-ui", "Table.Cell @example/old-ui", "ButtonGroup @example/old-ui",
    ]);
    const whole = successor({ packageName: "@example/old-ui" });
    expect(grouped(whole)[0]).toBe("@example/old-ui -/5 (Being replaced): ");
    expect(listed({ ...whole, scope: "@example/old-ui" })).toContain("SkeletonText @example/old-ui");
  });

  it("lists a package's names that share a word with the source first when choosing a replacement", () => {
    expect(listed({ mode: "successor", sources: estate, scope: "@example/new-ui", similarTo: "SkeletonText" }).slice(0, 2))
      .toEqual(["Skeleton @example/new-ui", "Button @example/new-ui"]);
  });
});

describe("searchSeries", () => {
  const comp = (componentId: string, displayName: string, packageName: string | null, occurrences: number, disambiguator: string | null = null): PickableComponent =>
    ({ componentId, displayName, packageName, disambiguator, deprecated: false, occurrences, local: packageName === null, lastSeenAt: null });
  const gone = (componentId: string, displayName: string, packageName: string, lastSeenAt: string): PickableComponent =>
    ({ ...comp(componentId, displayName, packageName, 0), lastSeenAt });
  const charted = [
    comp("c1", "Button", "@example/old-ui", 60), comp("c2", "ButtonGroup", "@example/old-ui", 6), comp("c3", "Card", "@example/old-ui", 10),
    comp("c4", "Button", "@example/new-ui", 8, "src/button/index.ts"), comp("c5", "Button", "@example/new-ui", 3, "src/legacy/button.ts"),
    comp("c6", "Header", null, 4, "src/Header.tsx"),
  ];
  const packages = ["@example/new-ui", "@example/old-ui"];
  const tags = [
    { id: "t-old", label: "old-ui", rule: { glob: [], exact: ["@example/old-ui"] } },
    { id: "t-new", label: "new-ui", rule: { glob: ["@example/*"], exact: [] } },
  ];
  const series = (over: Partial<SeriesSearchInput>) =>
    searchSeries({ tags, components: charted, packages, query: "", scope: null, added: new Set(), ...over });
  const seriesLabels = (over: Partial<SeriesSearchInput>) => series(over).rows.map(label);
  const keys = (...sels: CohortSelector[]) => new Set(sels.map(cohortKey));
  // Each package as "name matched/components: its rows", with "+" when it offers the rest.
  const grouped = (over: Partial<SeriesSearchInput>) =>
    groupSeries({ components: charted, packages, query: "", added: new Set(), ...over }).groups.map((g) =>
      `${g.packageName} ${g.matched ?? "-"}/${g.components}${g.more ? "+" : ""}: ${g.rows.map((r) => r.exportName).join(", ")}`);

  it("lists the tags, Local components, then packages by use when nothing is typed, each tag with the packages it matches", () => {
    const { rows, groups } = series({});
    expect(rows.map(label)).toEqual(["tag old-ui", "tag new-ui", "Local components"]);
    expect(rows).toMatchObject([{ packages: 1 }, { packages: 2 }, { components: 1 }]);
    expect(groups.map((g) => [g.packageName, g.components, g.rows.length])).toEqual([["@example/old-ui", 3, 0], ["@example/new-ui", 2, 0]]);
  });

  it("lists the tags and Local components a search matches, and its components only grouped by package", () => {
    expect(seriesLabels({ query: "new" })).toEqual(["tag new-ui"]);
    expect(seriesLabels({ query: "local" })).toEqual(["Local components"]);
    expect(series({ query: "button" })).toMatchObject({ rows: [], groups: [{ packageName: "@example/old-ui" }, { packageName: "@example/new-ui" }] });
  });

  it("narrowed to a package, lists each component by its id with its path", () => {
    expect(series({ scope: "@example/new-ui" }).rows).toMatchObject([
      { kind: "component", exportName: "Button", disambiguator: "src/button/index.ts", pick: { kind: "component", componentId: "c4" } },
      { kind: "component", exportName: "Button", disambiguator: "src/legacy/button.ts", pick: { kind: "component", componentId: "c5" } },
    ]);
  });

  it("lists packages and components only older scans hold after every one in use that matches as well, the most recently held first", () => {
    const components = [
      ...charted,
      gone("g1", "Button", "@example/legacy-kit", "2026-08-01T00:00:00.000Z"),
      gone("g2", "Alert", "@example/old-ui", "2026-06-01T00:00:00.000Z"),
      gone("g3", "Badge", "@example/old-ui", "2026-09-04T00:00:00.000Z"),
      gone("g4", "Card", "@example/older-kit", "2026-09-10T00:00:00.000Z"),
    ];
    const all = ["@example/empty", "@example/legacy-kit", "@example/new-ui", "@example/old-ui", "@example/older-kit"];

    expect(grouped({ components, packages: all, query: "button" })).toEqual([
      "@example/old-ui 2/5: Button, ButtonGroup", "@example/new-ui 2/2: Button, Button", "@example/legacy-kit 1/1: Button",
    ]);
    expect(seriesLabels({ components, packages: all, scope: "@example/old-ui" })).toEqual([
      "Button @example/old-ui", "Card @example/old-ui", "ButtonGroup @example/old-ui", "Badge @example/old-ui", "Alert @example/old-ui",
    ]);
    expect(series({ components, packages: all }).groups.map((g) => g.packageName)).toEqual([
      "@example/old-ui", "@example/new-ui", "@example/empty", "@example/older-kit", "@example/legacy-kit",
    ]);
  });

  it("marks the rows whose series are already added", () => {
    const added = keys({ kind: "tag", tagId: "t-new" }, { kind: "component", componentId: "c4" });
    const result = series({ query: "new", added });
    expect(result.rows.map((r) => r.added)).toEqual([true]);
    expect(result.groups[0]?.rows.map((r) => r.added)).toEqual([true, false]);
  });

  describe("groupSeries", () => {
    it("lists each matching component once, under its package, the packages by their best match and then by use", () => {
      expect(grouped({ query: "button" })).toEqual(["@example/old-ui 2/3: Button, ButtonGroup", "@example/new-ui 2/2: Button, Button"]);
      expect(grouped({ components: [...charted, comp("n1", "NewBadge", "@example/tiny", 1)], query: "new" })).toEqual([
        "@example/tiny 1/1: NewBadge", "@example/new-ui -/2: Button, Button",
      ]);
    });

    it("lists only the components of the package a second word names", () => {
      expect(grouped({ query: "new butt" })).toEqual(["@example/new-ui 2/2: Button, Button"]);
      expect(grouped({ query: "old butt" })).toEqual(["@example/old-ui 2/3: Button, ButtonGroup"]);
    });

    it("opens a package its name matches on its five most used components and offers the rest, after any of its components that match", () => {
      const kit = Array.from({ length: 7 }, (_, i) => comp(`k${i}`, i === 0 ? "KitButton" : `Kit${i}`, "@example/button-kit", i + 1));
      expect(grouped({ components: kit, packages: ["@example/button-kit"], query: "example" })).toEqual(["@example/button-kit -/7+: Kit6, Kit5, Kit4, Kit3, Kit2"]);
      expect(grouped({ components: kit, packages: ["@example/button-kit"], query: "button" })).toEqual(["@example/button-kit 1/7+: KitButton"]);
    });

    it("lists components no package holds apart from the packages", () => {
      expect(groupSeries({ components: charted, packages, query: "header", added: new Set() })).toMatchObject({ groups: [], unpackaged: [{ exportName: "Header" }] });
    });

    it("stops at 50 components across every package and says how many there are", () => {
      const icons = Array.from({ length: 60 }, (_, i) => comp(`i${i}`, `Icon${i}`, "@example/glyphs", 1));
      const result = groupSeries({ components: [...icons, comp("x", "IconX", "@example/more", 0)], packages: [], query: "icon", added: new Set() });
      expect(result.groups.map((g) => [g.packageName, g.rows.length])).toEqual([["@example/glyphs", MAX_COMPONENT_ROWS]]);
      expect(result.total).toBe(61);
    });
  });
});
