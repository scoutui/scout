import { describe, it, expect } from "vitest";
import type { PackageSummary } from "@scoutui/web-shared";
import {
  emptyPackageFacets,
  filterPackageRows,
  packageFacetOptions,
  packageFacetsToParams,
  paramsToPackageFacets,
  versionsValueOf,
  type PackageFacetState,
} from "@/lib/package-facets";
import { queryString } from "@/lib/query-string";

const row = (over: Partial<PackageSummary>): PackageSummary => ({
  packageName: "@x/lib",
  consumerCount: 1,
  componentCount: 1,
  totalOccurrences: 1,
  deprecatedCount: 0,
  distinctVersionCount: 1,
  soleVersion: "1.0.0",
  ...over,
});

describe("versionsValueOf", () => {
  it("classifies by distinctVersionCount", () => {
    expect(versionsValueOf(row({ distinctVersionCount: 0, soleVersion: null }))).toBe("unversioned");
    expect(versionsValueOf(row({ distinctVersionCount: 1 }))).toBe("single");
    expect(versionsValueOf(row({ distinctVersionCount: 4, soleVersion: null }))).toBe("multi");
  });
});

describe("filterPackageRows", () => {
  const rows = [
    row({ packageName: "@x/lib", distinctVersionCount: 3, soleVersion: null, tags: [{ id: "t1", value: "ds", color: "#123456", category: null }] }),
    row({ packageName: "@x/wc", deprecatedCount: 2 }),
    row({ packageName: "local-pkg", distinctVersionCount: 0, soleVersion: null }),
  ];

  it("matches name substring case-insensitively", () => {
    const f = { ...emptyPackageFacets(), text: "X/L" };
    expect(filterPackageRows(rows, f).map(r => r.packageName)).toEqual(["@x/lib"]);
  });

  it("matches any selected tag", () => {
    const f = { ...emptyPackageFacets(), tags: ["ds"] };
    expect(filterPackageRows(rows, f).map(r => r.packageName)).toEqual(["@x/lib"]);
  });

  it("filters by versions cardinality", () => {
    expect(filterPackageRows(rows, { ...emptyPackageFacets(), versions: "multi" }).map(r => r.packageName)).toEqual(["@x/lib"]);
    expect(filterPackageRows(rows, { ...emptyPackageFacets(), versions: "unversioned" }).map(r => r.packageName)).toEqual(["local-pkg"]);
  });

  it("filters by deprecated-in-use either way", () => {
    expect(filterPackageRows(rows, { ...emptyPackageFacets(), deprecated: true }).map(r => r.packageName)).toEqual(["@x/wc"]);
    expect(filterPackageRows(rows, { ...emptyPackageFacets(), deprecated: false }).map(r => r.packageName)).toEqual(["@x/lib", "local-pkg"]);
  });
});

describe("packageFacetOptions: every count follows the other filters", () => {
  const forms = { id: "t1", value: "forms", color: "#009598", category: null };
  const core = { id: "t2", value: "core", color: "#2863ab", category: null };
  const rows = [
    row({ packageName: "@x/forms", distinctVersionCount: 3, soleVersion: null, deprecatedCount: 1, tags: [forms] }),
    row({ packageName: "@x/core", tags: [core] }),
    row({ packageName: "@x/both", deprecatedCount: 2, tags: [forms, core] }),
    row({ packageName: "lodash", distinctVersionCount: 0, soleVersion: null }),
  ];

  it("counts versions and the deprecated chip over the packages the selected tag leaves", () => {
    const o = packageFacetOptions(rows, { ...emptyPackageFacets(), tags: ["forms"] });
    expect(o.versions).toEqual({ multi: 1, single: 1, unversioned: 0 });
    expect(o.deprecatedCount).toBe(2);
  });

  it("counts every tag under the other filters, ignoring the tag selection itself", () => {
    const o = packageFacetOptions(rows, { ...emptyPackageFacets(), tags: ["forms"], versions: "single" });
    expect(o.tags).toEqual([
      { value: "core", color: "#2863ab", count: 2 },
      { value: "forms", color: "#009598", count: 1 },
    ]);
  });

  it("lists a tag the other filters leave at zero, and a selected tag no package has", () => {
    const o = packageFacetOptions(rows, { ...emptyPackageFacets(), text: "core", tags: ["gone"] });
    expect(o.tags).toEqual([
      { value: "core", color: "#2863ab", count: 1 },
      { value: "forms", color: "#009598", count: 0 },
      { value: "gone", color: "", count: 0 },
    ]);
  });

  it("keeps the most the deprecated chip can read and the total over every package", () => {
    const o = packageFacetOptions(rows, { ...emptyPackageFacets(), text: "core" });
    expect(o).toMatchObject({ deprecatedCount: 0, deprecatedMax: 2, total: 4 });
  });
});

describe("URL params", () => {
  it.each<[string, Partial<PackageFacetState>, string]>([
    ["search text", { text: "@acme/ui" }, "q=@acme/ui"],
    ["one tag param per tag", { tags: ["ds", "icon set"] }, "tag=ds&tag=icon+set"],
    ["versions", { versions: "multi" }, "versions=multi"],
    ["deprecated", { deprecated: true }, "deprecated=true"],
    ["not deprecated", { deprecated: false }, "deprecated=false"],
  ])("writes and reads %s", (_case, facets, written) => {
    const f = { ...emptyPackageFacets(), ...facets };
    expect(queryString(packageFacetsToParams(f))).toBe(written);
    expect(paramsToPackageFacets(new URLSearchParams(written))).toEqual(f);
  });

  it("writes no params for no filters", () => {
    expect(packageFacetsToParams(emptyPackageFacets())).toEqual([]);
  });

  it.each([
    ["a param it doesn't know", "nonsense=zzz"],
    ["versions it doesn't know", "versions=weird"],
    ["deprecated other than true or false", "deprecated=yes"],
  ])("ignores %s", (_case, written) => {
    expect(paramsToPackageFacets(new URLSearchParams(written))).toEqual(emptyPackageFacets());
  });
});
