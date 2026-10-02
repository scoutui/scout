import { describe, it, expect } from "vitest";
import {
  packageComponentFiltersToParams,
  paramsToPackageComponentFilters,
  type PackageComponentFilters,
} from "@/lib/package-facets";
import { queryString } from "@/lib/query-string";

describe("URL params (package components table filters)", () => {
  it.each<[string, PackageComponentFilters, string]>([
    ["search text", { text: "@scope/button", deprecated: false }, "q=@scope/button"],
    ["deprecated only", { text: "", deprecated: true }, "deprecated=true"],
    ["no filters", { text: "", deprecated: false }, ""],
  ])("writes and reads %s", (_case, f, written) => {
    expect(queryString(packageComponentFiltersToParams(f))).toBe(written);
    expect(paramsToPackageComponentFilters(new URLSearchParams(written))).toEqual(f);
  });
});
