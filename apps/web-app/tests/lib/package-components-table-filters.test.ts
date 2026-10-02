import { describe, it, expect } from "vitest";
import {
  filtersToQuery,
  queryToFilters,
  type Filters,
} from "@/components/packages/package-components-table";

describe("?q= round-trip (package components table filters)", () => {
  it("serialises and re-parses losslessly, and empty filters as no query", () => {
    const f: Filters = { text: "@scope/button", deprecated: true };
    const q = filtersToQuery(f);
    expect(q).toBe('name:"@scope/button" deprecated:true');
    expect(queryToFilters(q)).toEqual(f);
    expect(filtersToQuery({ text: "", deprecated: false })).toBe("");
  });
});
