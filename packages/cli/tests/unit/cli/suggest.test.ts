import { describe, it, expect } from "vitest";
import { editDistance, nearestMatch } from "../../../src/cli/suggest.js";

describe("editDistance", () => {
  it("is 0 for identical strings", () => expect(editDistance("scan", "scan")).toBe(0));
  it("counts single edits", () => {
    expect(editDistance("scn", "scan")).toBe(1);
    expect(editDistance("rescn", "rescan")).toBe(1);
    expect(editDistance("scen", "scan")).toBe(1);
  });
  it("equals the longer length when one side is empty", () => {
    expect(editDistance("", "scan")).toBe(4);
    expect(editDistance("scan", "")).toBe(4);
  });
});

describe("nearestMatch", () => {
  const commands = ["scan", "init", "auth"];
  it("finds the closest candidate within the default distance", () => {
    expect(nearestMatch("scn", commands)).toBe("scan");
    expect(nearestMatch("ini", commands)).toBe("init");
  });
  it("returns undefined when nothing is close enough", () => {
    expect(nearestMatch("xyzzy", commands)).toBeUndefined();
  });
  it("honours a custom max distance", () => {
    expect(nearestMatch("scaaan", commands, 1)).toBeUndefined();
    expect(nearestMatch("scaaan", commands, 2)).toBe("scan");
  });
});
