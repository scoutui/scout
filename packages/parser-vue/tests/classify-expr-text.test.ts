import { describe, it, expect } from "vitest";
import { classifyExprText } from "../src/classify-expr-text.js";

describe("classifyExprText", () => {
  it("bare identifier → reference", () => {
    expect(classifyExprText("small")).toEqual({ tier: "reference", ref: "small" });
  });
  it("dotted member path → reference", () => {
    expect(classifyExprText("props.size")).toEqual({ tier: "reference", ref: "props.size" });
    expect(classifyExprText("theme.spacing.md")).toEqual({ tier: "reference", ref: "theme.spacing.md" });
  });
  it("anything else → dynamic", () => {
    expect(classifyExprText("getSize()")).toEqual({ tier: "dynamic" });
    expect(classifyExprText("a ? b : c")).toEqual({ tier: "dynamic" });
    expect(classifyExprText("a[0]")).toEqual({ tier: "dynamic" });
  });
});
