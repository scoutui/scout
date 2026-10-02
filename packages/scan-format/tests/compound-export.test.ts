import { describe, expect, it } from "vitest";
import { parseCompoundExport } from "../src/compound-export.js";

describe("parseCompoundExport", () => {
  it("returns isCompound:false for a bare identifier", () => {
    expect(parseCompoundExport("Tabs")).toEqual({
      root: "Tabs",
      path: [],
      isCompound: false,
    });
  });

  it("parses a single-hop compound", () => {
    expect(parseCompoundExport("Tabs.Trigger")).toEqual({
      root: "Tabs",
      path: ["Trigger"],
      isCompound: true,
    });
  });

  it("parses a multi-hop compound", () => {
    expect(parseCompoundExport("Form.Field.Label")).toEqual({
      root: "Form",
      path: ["Field", "Label"],
      isCompound: true,
    });
  });
});
