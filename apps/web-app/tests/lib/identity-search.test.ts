import { describe, expect, it } from "vitest";
import type { GovernanceRecord } from "@scoutui/web-shared";
import type { GovernanceTarget } from "@scoutui/web-shared";
import type { CohortSelector } from "@scoutui/web-shared";
import { cohortKey } from "@scoutui/web-shared/client";
import type { PickableComponent } from "@/lib/chart-builder-series";
import { MAX_COMPONENT_ROWS, type SearchInput, type SearchRow, type SeriesSearchInput, searchSeries, searchTargets } from "@/lib/identity-search";

const target = (packageName: string, exportName: string, occurrences: number): GovernanceTarget => ({ packageName, exportName, occurrences });
const pkg = (packageName: string, occurrences: number): GovernanceTarget => ({ packageName, occurrences });

const record = (id: string, targetPackage: string, targetExport: string | null): GovernanceRecord => ({
  id, grain: targetExport === null ? "package" : "component", targetPackage, targetExport,
  disposition: { kind: "retired", reason: "replaced" }, createdAt: "t", updatedAt: "t",
});

const search = (over: Partial<SearchInput>) =>
  searchTargets({ mode: "source", sources: [], query: "", scope: null, records: [], ...over });

const label = (row: SearchRow<unknown>) =>
  row.kind === "package" ? `package ${row.packageName}`
    : row.kind === "whole" ? `all ${row.packageName}${row.refusal ? ` (${row.refusal})` : ""}`
      : row.kind === "tag" ? `tag ${row.label}`
        : row.kind === "local" ? row.label
          : `${row.exportName} ${row.packageName}${row.refusal ? ` (${row.refusal})` : ""}`;
const labels = (over: Partial<SearchInput>) => search(over).rows.map(label);

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
  it("ranks by where the term matches before how often a component is used", () => {
    expect(labels({ sources: tiers, query: "tab" })).toEqual([
      "package @example/tabs",
      "Tab @example/kit", "Table @example/kit", "DataTable @example/kit",
      "TextAreaBox @example/kit", "Panel @example/tabs", "Stable @example/kit",
    ]);
  });

  it("breaks ties by occurrences, then name, then package", () => {
    const sources = [target("@example/b", "Button", 9), target("@example/a", "Button", 5), target("@example/c", "Button", 9)];
    expect(labels({ sources, query: "button" })).toEqual(["Button @example/b", "Button @example/c", "Button @example/a"]);
  });

  it("needs every term to match and ranks by the weakest one", () => {
    expect(labels({ sources: tiers, query: "kit tab" })).toEqual([
      "TextAreaBox @example/kit", "DataTable @example/kit", "Table @example/kit", "Tab @example/kit", "Stable @example/kit",
    ]);
  });

  it("marks the matched parts of the name", () => {
    const rows = search({ sources: estate, query: "dp", scope: "@example/new-ui" }).rows;
    expect(rows.find((r) => r.kind === "component" && r.exportName === "DialogPopup")).toMatchObject({ matched: [[0, 1], [6, 7]] });
    const overlapping = search({ sources: estate, query: "dia dialog", scope: "@example/new-ui" }).rows;
    expect(overlapping.find((r) => r.kind === "component" && r.exportName === "DialogPanel")).toMatchObject({ matched: [[0, 6]] });
  });

  it("offers a target only older scans have, after the used ones", () => {
    expect(labels({ sources: estate }).at(-1)).toBe("package @example/unused");
    expect(labels({ sources: estate, query: "gone" })).toEqual(["Gone @example/unused"]);
  });
});

describe("searchTargets: packages", () => {
  it("lists every package by occurrences when nothing is typed, the first one active", () => {
    const result = search({ sources: estate });
    expect(result.rows.map(label)).toEqual([
      "package @example/old-ui", "package @example/new-ui", "package @example/legacy-kit", "package @example/unused",
    ]);
    expect(result.rows[0]).toMatchObject({ components: 5 });
    expect(result.defaultIndex).toBe(0);
  });

  it("puts packages whose name matches before the components, at most three", () => {
    expect(labels({ sources: estate, query: "new" }).slice(0, 2)).toEqual(["package @example/new-ui", "Button @example/new-ui"]);
    expect(labels({ sources: estate, query: "old-ui" }).slice(0, 2)).toEqual(["package @example/old-ui", "Button @example/old-ui"]);
    expect(labels({ sources: estate, query: "example/new-ui" }).slice(0, 2)).toEqual(["package @example/new-ui", "Button @example/new-ui"]);
    expect(labels({ sources: [...estate].reverse(), query: "example" }).filter((l) => l.startsWith("package"))).toEqual([
      "package @example/old-ui", "package @example/new-ui", "package @example/legacy-kit",
    ]);
    expect(labels({ sources: estate, query: "button" })[0]).toBe("Button @example/old-ui");
  });

  it("shows at most 50 components across every package, and all of them in one package", () => {
    const sources = [pkg("@example/glyphs", 60), ...Array.from({ length: 60 }, (_, i) => target("@example/glyphs", `Icon${i}`, 1))];
    expect(search({ sources, query: "icon" }).rows).toHaveLength(MAX_COMPONENT_ROWS);
    expect(search({ sources, query: "icon", scope: "@example/glyphs" }).rows).toHaveLength(60);
  });
});

describe("searchTargets: packages defined in a scanned repo", () => {
  const local = (t: GovernanceTarget): GovernanceTarget => ({ ...t, local: true });
  const monorepo = [
    pkg("@example/legacy-kit", 20), target("@example/legacy-kit", "Button", 20),
    local(pkg("@example/app", 500)), local(target("@example/app", "Page", 300)), local(target("@example/app", "Header", 200)),
    local(pkg("@example/ui", 90)), local(target("@example/ui", "Button", 60)), local(target("@example/ui", "ButtonGroup", 30)),
    local(pkg("@example/next-ui", 10)), local(target("@example/next-ui", "Button", 10)),
  ];

  it("lists them after the installed packages when nothing is typed", () => {
    expect(labels({ sources: monorepo })).toEqual([
      "package @example/legacy-kit", "package @example/app", "package @example/ui", "package @example/next-ui",
    ]);
  });

  it("leaves their components out of a search with no package chosen and offers their packages after the results", () => {
    const { rows } = search({ sources: monorepo, query: "button" });
    expect(rows.map(label)).toEqual(["Button @example/legacy-kit", "package @example/ui", "package @example/next-ui"]);
    expect(rows.slice(1)).toMatchObject([{ matches: 2, narrowedQuery: "button" }, { matches: 1, narrowedQuery: "button" }]);
  });

  it("makes the first package active when no installed component matches", () => {
    const result = search({ sources: monorepo, query: "header" });
    expect(result.rows.map(label)).toEqual(["package @example/app"]);
    expect(result.defaultIndex).toBe(0);
  });

  it("keeps only the words that didn't match the package's name for the narrowed search", () => {
    expect(search({ sources: monorepo, query: "next button" }).rows).toMatchObject([
      { kind: "package", packageName: "@example/next-ui", matches: 1, narrowedQuery: "button" },
    ]);
  });

  it("offers a package once when its name matches too, and at most five for the names they hold", () => {
    expect(search({ sources: monorepo, query: "ui" }).rows).toMatchObject([
      { packageName: "@example/ui", matches: null, narrowedQuery: "" }, { packageName: "@example/next-ui", matches: null, narrowedQuery: "" },
    ]);
    const many = ["a", "b", "c", "d", "e", "f"].flatMap((p) => [local(pkg(`@example/${p}`, 1)), local(target(`@example/${p}`, "Button", 1))]);
    expect(labels({ sources: many, query: "button" })).toHaveLength(5);
  });

  it("lists their components once the search is narrowed to them", () => {
    expect(labels({ sources: monorepo, query: "button", scope: "@example/ui" })).toEqual(["Button @example/ui", "ButtonGroup @example/ui"]);
  });
});

describe("searchTargets: narrowed to a package", () => {
  it("offers the whole package first, then its components by occurrences, with the first component active", () => {
    const result = search({ sources: estate, scope: "@example/new-ui" });
    expect(result.rows.map(label)).toEqual([
      "all @example/new-ui", "Button @example/new-ui", "Skeleton @example/new-ui", "Avatar @example/new-ui", "CardPanel @example/new-ui",
      "DialogPanel @example/new-ui", "DialogPopup @example/new-ui", "AlertDialogPopup @example/new-ui",
    ]);
    expect(result.rows[0]).toMatchObject({ components: 7 });
    expect(result.defaultIndex).toBe(1);
  });

  it("matches names only, and offers the whole package only when the search matches its name", () => {
    expect(labels({ sources: estate, scope: "@example/new-ui", query: "dp" })).toEqual([
      "DialogPanel @example/new-ui", "DialogPopup @example/new-ui", "AlertDialogPopup @example/new-ui", "CardPanel @example/new-ui",
    ]);
    expect(labels({ sources: estate, scope: "@example/new-ui", query: "ui" })).toEqual(["all @example/new-ui"]);
  });

  it("puts names that share a word with the source first when choosing a replacement", () => {
    expect(labels({ mode: "successor", sources: estate, scope: "@example/new-ui", similarTo: "SkeletonText" }).slice(0, 3))
      .toEqual(["all @example/new-ui", "Skeleton @example/new-ui", "Button @example/new-ui"]);
  });
});

describe("searchTargets: refusals", () => {
  const records = [
    record("button", "@example/old-ui", "Button"),
    record("dialog", "@example/old-ui", "DialogContent"),
    record("kit", "@example/legacy-kit", null),
  ];

  it.each([
    ["the same component", { query: "button" }, "Button @example/old-ui (Already recorded)"],
    ["a component of a package with a record", { query: "button" }, "Button @example/legacy-kit (Whole package recorded)"],
    ["a package with a record", { scope: "@example/legacy-kit" }, "all @example/legacy-kit (Already recorded)"],
    ["a package with component records", { scope: "@example/old-ui" }, "all @example/old-ui (2 components already recorded)"],
  ])("refuses %s", (_, over, expected) => {
    expect(labels({ sources: estate, records, ...over })).toContain(expected);
  });

  it("says one component when one is recorded", () => {
    expect(labels({ sources: estate, records: [records[0] as GovernanceRecord], scope: "@example/old-ui" })[0])
      .toBe("all @example/old-ui (1 component already recorded)");
  });

  it("puts refused rows last among rows that match as well, and never makes one active", () => {
    const result = search({ sources: estate, records, query: "button" });
    expect(result.rows.map(label)).toEqual([
      "Button @example/new-ui", "Button @example/old-ui (Already recorded)", "Button @example/legacy-kit (Whole package recorded)",
      "ButtonGroup @example/old-ui",
    ]);
    expect(result.defaultIndex).toBe(0);
  });

  it("puts refused rows last in a narrowed list and leaves nothing active when every component is refused", () => {
    expect(labels({ sources: estate, records, scope: "@example/old-ui" })).toEqual([
      "all @example/old-ui (2 components already recorded)",
      "SkeletonText @example/old-ui", "Table.Cell @example/old-ui", "ButtonGroup @example/old-ui",
      "Button @example/old-ui (Already recorded)", "DialogContent @example/old-ui (Already recorded)",
    ]);
    expect(search({ sources: estate, records: [record("kit", "@example/legacy-kit", null)], scope: "@example/legacy-kit" }).defaultIndex).toBeNull();
  });

  it("keeps the edited record's own target pickable", () => {
    expect(labels({ sources: estate, records, editingId: "button", query: "button" })).toContain("Button @example/old-ui");
  });

  it("refuses nothing in a replacement, and leaves out the record's own source", () => {
    const rows = labels({ mode: "successor", sources: estate, records, scope: "@example/old-ui", exclude: { packageName: "@example/old-ui", exportName: "SkeletonText" } });
    expect(rows).toContain("Button @example/old-ui");
    expect(rows).toContain("all @example/old-ui");
    expect(rows).not.toContain("SkeletonText @example/old-ui");
    const wholeExcluded = labels({ mode: "successor", sources: estate, records, scope: "@example/old-ui", exclude: { packageName: "@example/old-ui" } });
    expect(wholeExcluded).toContain("SkeletonText @example/old-ui");
    expect(wholeExcluded).not.toContain("all @example/old-ui");
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
  const tags = [
    { id: "t-old", label: "old-ui", rule: { glob: [], exact: ["@example/old-ui"] } },
    { id: "t-new", label: "new-ui", rule: { glob: ["@example/*"], exact: [] } },
  ];
  const series = (over: Partial<SeriesSearchInput>) =>
    searchSeries({ tags, components: charted, packages: ["@example/new-ui", "@example/old-ui"], query: "", scope: null, added: new Set(), ...over });
  const seriesLabels = (over: Partial<SeriesSearchInput>) => series(over).rows.map(label);
  const keys = (...sels: CohortSelector[]) => new Set(sels.map(cohortKey));

  it("lists the tags, Local components, then packages by use when nothing is typed, each tag with the packages it matches", () => {
    const { rows } = series({});
    expect(rows.map(label)).toEqual(["tag old-ui", "tag new-ui", "Local components", "package @example/old-ui", "package @example/new-ui"]);
    expect(rows.slice(0, 3)).toMatchObject([{ packages: 1 }, { packages: 2 }, { components: 1 }]);
  });

  it("puts the tags and packages a search matches before the components it ranks, the first row active", () => {
    const result = series({ query: "new" });
    expect(result.rows.map(label)).toEqual(["tag new-ui", "package @example/new-ui", "Button @example/new-ui", "Button @example/new-ui"]);
    expect(result.defaultIndex).toBe(0);
    expect(seriesLabels({ query: "button" })).toEqual(["Button @example/old-ui", "Button @example/new-ui", "Button @example/new-ui", "ButtonGroup @example/old-ui"]);
    expect(seriesLabels({ query: "local" })).toEqual(["Local components"]);
    expect(seriesLabels({ query: "header" })).toEqual(["Header null"]);
  });

  it("shows at most 50 components across every package, and all of them in one package", () => {
    const icons = Array.from({ length: 60 }, (_, i) => comp(`i${i}`, `Icon${i}`, "@example/glyphs", 1));
    expect(series({ components: icons, packages: ["@example/glyphs"], query: "icon" })).toMatchObject({ total: 60, rows: { length: MAX_COMPONENT_ROWS } });
    expect(series({ components: icons, packages: ["@example/glyphs"], query: "icon", scope: "@example/glyphs" }).rows).toHaveLength(60);
  });

  it("narrowed to a package, offers the whole package as a series, then each component by its id with its path", () => {
    expect(series({ scope: "@example/new-ui" }).rows).toMatchObject([
      { kind: "whole", components: 2, pick: { kind: "package", packageName: "@example/new-ui" } },
      { kind: "component", exportName: "Button", disambiguator: "src/button/index.ts", pick: { kind: "component", componentId: "c4" } },
      { kind: "component", exportName: "Button", disambiguator: "src/legacy/button.ts", pick: { kind: "component", componentId: "c5" } },
    ]);
  });

  it("lists components and packages only older scans hold after every one in use, the most recently held first", () => {
    const components = [
      ...charted,
      gone("g1", "Button", "@example/legacy-kit", "2026-08-01T00:00:00.000Z"),
      gone("g2", "Alert", "@example/old-ui", "2026-06-01T00:00:00.000Z"),
      gone("g3", "Badge", "@example/old-ui", "2026-09-04T00:00:00.000Z"),
      gone("g4", "Card", "@example/older-kit", "2026-09-10T00:00:00.000Z"),
    ];
    const packages = ["@example/empty", "@example/legacy-kit", "@example/new-ui", "@example/old-ui", "@example/older-kit"];
    const ordered = (over: Partial<SeriesSearchInput>) => seriesLabels({ components, packages, ...over });

    expect(ordered({ query: "button" })).toEqual([
      "Button @example/old-ui", "Button @example/new-ui", "Button @example/new-ui", "ButtonGroup @example/old-ui", "Button @example/legacy-kit",
    ]);
    expect(ordered({ scope: "@example/old-ui" })).toEqual([
      "all @example/old-ui", "Button @example/old-ui", "Card @example/old-ui", "ButtonGroup @example/old-ui", "Badge @example/old-ui", "Alert @example/old-ui",
    ]);
    expect(ordered({}).filter((l) => l.startsWith("package"))).toEqual([
      "package @example/old-ui", "package @example/new-ui", "package @example/empty", "package @example/older-kit", "package @example/legacy-kit",
    ]);
  });

  it("marks the rows whose series are already added", () => {
    const added = keys({ kind: "tag", tagId: "t-new" }, { kind: "package", packageName: "@example/new-ui" }, { kind: "component", componentId: "c4" });
    expect(series({ query: "new", added }).rows.map((r) => (r.kind === "package" ? null : r.added))).toEqual([true, null, true, false]);
    expect(series({ scope: "@example/new-ui", added }).rows[0]).toMatchObject({ kind: "whole", added: true });
  });
});
