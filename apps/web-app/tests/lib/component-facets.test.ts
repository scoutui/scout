import { describe, it, expect } from "vitest";
import type { ComponentRow } from "@scoutui/web-shared";
import {
  emptyFacets,
  facetOptions,
  facetsToParams,
  filterRows,
  paramsToFacets,
  writtenNameMatch,
  type FacetState,
} from "@/lib/component-facets";
import { queryString } from "@/lib/query-string";

describe("search text", () => {
  const row: ComponentRow = {
    componentId: "", kind: "react-component", scope: "local", packageName: null,
    displayName: "", disambiguator: null, version: null,
    occurrenceCount: 1, fileCount: 1, deprecated: false, tags: [],
  };
  const header: ComponentRow = { ...row, componentId: "header", displayName: "Header", writtenNames: ["SettingsHeader"] };
  const settings: ComponentRow = { ...row, componentId: "settings", displayName: "Settings" };

  it("finds a component by a name files write for it, and says which name matched", () => {
    const text = "settingsh";
    expect(filterRows([header, settings], { ...emptyFacets(), text }).map(r => r.componentId)).toEqual(["header"]);
    expect(writtenNameMatch(header, text)).toBe("SettingsHeader");
  });

  it("names no written name when the display name matches", () => {
    expect(filterRows([header, settings], { ...emptyFacets(), text: "settings" }).map(r => r.componentId)).toEqual(["header", "settings"]);
    expect(writtenNameMatch(header, "head")).toBeUndefined();
  });
});

describe("facetOptions: every count follows the other filters", () => {
  const ds = { id: "t-ds", value: "ds", category: null, color: "#000" };
  const row: ComponentRow = {
    componentId: "", kind: "react-component", scope: "external", packageName: null,
    displayName: "", disambiguator: null, version: null,
    occurrenceCount: 1, fileCount: 1, deprecated: false, tags: [],
  };
  const a: ComponentRow = { ...row, componentId: "a", displayName: "A", packageName: "@x/lib", tags: [ds], deprecated: true };
  const b: ComponentRow = { ...row, componentId: "b", displayName: "B", kind: "vue-component", packageName: "@x/lib" };
  const c: ComponentRow = { ...row, componentId: "c", displayName: "C", scope: "local", tags: [ds] };
  const d: ComponentRow = { ...row, componentId: "d", displayName: "D", packageName: "@y/ui" };
  const rows = [a, b, c, d];

  it("each facet counts under the other facets and ignores its own selections", () => {
    const o = facetOptions(rows, null, { ...emptyFacets(), packages: ["@x/lib"], kinds: ["react"] });
    // Packages ignore `package` but keep `kind:react`: B (vue) does not count toward @x/lib.
    expect(o.packages).toEqual([{ value: "@x/lib", count: 1 }, { value: "@y/ui", count: 1 }]);
    // Framework ignores `kind` but keeps `package:@x/lib`: A (react) and B (vue).
    expect(o.kinds).toEqual([{ value: "react", count: 1 }, { value: "vue", count: 1 }]);
    // Origin, Tag and the deprecated chip keep both: only A.
    expect(o.origin).toEqual({ external: 1, local: 0 });
    expect(o.tags).toEqual([{ value: "ds", color: "#000", count: 1 }]);
    expect(o.deprecatedCount).toBe(1);
  });

  it("search text, occurrences and deprecated narrow every facet; deprecated ignores only itself", () => {
    const o = facetOptions(rows, null, { ...emptyFacets(), text: "c", deprecated: true });
    expect(o.origin).toEqual({ external: 0, local: 0 }); // C matches the text but is not deprecated
    expect(o.deprecatedCount).toBe(0);
    const occ = facetOptions(rows, null, { ...emptyFacets(), occurrences: { op: ">=", value: 2 } });
    expect(occ.packages).toEqual([{ value: "@x/lib", count: 0 }, { value: "@y/ui", count: 0 }]);
  });

  it("lists every value the base holds, at 0 when the other filters exclude it, so a selection stays visible", () => {
    const o = facetOptions(rows, null, { ...emptyFacets(), origin: "local", packages: ["@y/ui"] });
    expect(o.packages).toEqual([{ value: "@x/lib", count: 0 }, { value: "@y/ui", count: 0 }]);
  });

  it("counts the changed view's candidates, ghosts included, under every other filter; null without a changed view", () => {
    const ghost: ComponentRow = { ...row, componentId: "g", displayName: "Ghost", packageName: "@x/old", tags: [ds] };
    const changed = [b, ghost];
    expect(facetOptions(rows, changed, emptyFacets()).changedCount).toBe(2);
    expect(facetOptions(rows, changed, { ...emptyFacets(), tags: ["ds"] }).changedCount).toBe(1);
    // `changed` itself never narrows the chip's own count.
    expect(facetOptions(rows, changed, { ...emptyFacets(), changed: true, tags: ["ds"] }).changedCount).toBe(1);
    expect(facetOptions(rows, null, emptyFacets()).changedCount).toBeNull();
    // In the changed view the counts run over the view's rows: a package only a
    // ghost had is offered, and an unmoved package is still listed, at 0.
    const inView = facetOptions(rows, changed, { ...emptyFacets(), changed: true, packages: ["@y/ui"] }).packages;
    expect(inView).toContainEqual({ value: "@x/old", count: 1 });
    expect(inView).toContainEqual({ value: "@x/lib", count: 1 }); // B only; A did not move
    expect(inView).toContainEqual({ value: "@y/ui", count: 0 });
  });

  it("reports each chip's ceiling regardless of filters: every deprecated row, ghosts included, and every changed-view row", () => {
    const depGhost: ComponentRow = { ...row, componentId: "dg", displayName: "DepGhost", deprecated: true };
    const changed = [b, depGhost];
    const narrow = { ...emptyFacets(), changed: true, text: "zzz", deprecated: true };
    expect(facetOptions(rows, changed, narrow)).toMatchObject({ deprecatedCount: 0, changedCount: 0, deprecatedMax: 2, changedMax: 2 });
    expect(facetOptions(rows, null, emptyFacets())).toMatchObject({ deprecatedMax: 1, changedMax: 0 });
  });

  it("lists a selected value the page doesn't know, at 0, so a pasted URL's selection can be unticked", () => {
    const o = facetOptions(rows, null, { ...emptyFacets(), packages: ["@nope/pkg"], tags: ["gone"] });
    expect(o.packages).toContainEqual({ value: "@nope/pkg", count: 0 });
    expect(o.tags).toContainEqual({ value: "gone", color: "", count: 0 });
  });
});

describe("URL params", () => {
  it.each<[string, Partial<FacetState>, string]>([
    ["search text", { text: "date picker" }, "q=date+picker"],
    ["origin", { origin: "local" }, "origin=local"],
    ["one kind param per kind", { kinds: ["react", "vue"] }, "kind=react&kind=vue"],
    ["one package param per package", { packages: ["@acme/ui", "@acme/icons"] }, "package=@acme/ui&package=@acme/icons"],
    ["one tag param per tag", { tags: ["icons", "acme-ui"] }, "tag=icons&tag=acme-ui"],
    ["deprecated", { deprecated: true }, "deprecated=true"],
    ["not deprecated", { deprecated: false }, "deprecated=false"],
    ["at least N uses", { occurrences: { op: ">=", value: 10 } }, "uses=gte:10"],
    ["more than N uses", { occurrences: { op: ">", value: 10 } }, "uses=gt:10"],
    ["at most N uses", { occurrences: { op: "<=", value: 10 } }, "uses=lte:10"],
    ["fewer than N uses", { occurrences: { op: "<", value: 10 } }, "uses=lt:10"],
    ["exactly N uses", { occurrences: { op: "=", value: 10 } }, "uses=10"],
    ["changed since the previous scan", { changed: true }, "changed=true"],
  ])("writes and reads %s", (_case, facets, written) => {
    const f = { ...emptyFacets(), ...facets };
    expect(queryString(facetsToParams(f))).toBe(written);
    expect(paramsToFacets(new URLSearchParams(written))).toEqual(f);
  });

  it("writes no params for no filters", () => {
    expect(facetsToParams(emptyFacets())).toEqual([]);
  });

  it.each([
    ["a param it doesn't know", "usages=gte:10"],
    ["an origin it doesn't know", "origin=elsewhere"],
    ["a kind it doesn't know", "kind=svelte"],
    ["uses it can't read", "uses=>=10"],
    ["deprecated other than true or false", "deprecated=yes"],
    ["changed other than true", "changed=yes"],
  ])("ignores %s", (_case, written) => {
    expect(paramsToFacets(new URLSearchParams(written))).toEqual(emptyFacets());
  });

  it("reads a repeated value once", () => {
    expect(paramsToFacets(new URLSearchParams("tag=icons&tag=icons")).tags).toEqual(["icons"]);
  });
});
