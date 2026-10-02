import { describe, it, expect } from "vitest";
import { seriesCanOverlap } from "@/lib/cohort-overlap";

describe("seriesCanOverlap", () => {
  it("false for distinct single components (a clean partition)", () => {
    expect(seriesCanOverlap([{ kind: "component", componentId: "a" }, { kind: "component", componentId: "b" }])).toBe(false);
  });
  it("false for a single series", () => {
    expect(seriesCanOverlap([{ kind: "tag", tagId: "web" }])).toBe(false);
  });
  it("true when a package and a tag are mixed (may share members)", () => {
    expect(seriesCanOverlap([{ kind: "package", packageName: "@x/ui" }, { kind: "tag", tagId: "web" }])).toBe(true);
  });
  it("true for two tags (libraries can overlap)", () => {
    expect(seriesCanOverlap([{ kind: "tag", tagId: "web" }, { kind: "tag", tagId: "legacy" }])).toBe(true);
  });
});
