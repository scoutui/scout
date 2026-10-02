import { describe, expect, it } from "vitest";
import { isUsed, strongerUsage } from "../src/usage.js";

describe("counting seam", () => {
  it("isUsed: only a direct usage is used", () => {
    expect(isUsed({ usage: "direct" })).toBe(true);
    expect(isUsed({ usage: "root" })).toBe(false);
    expect(isUsed({ usage: "none" })).toBe(false);
  });
});

describe("strongerUsage: cross-repo merge order", () => {
  it("direct beats every other kind", () => {
    expect(strongerUsage("direct", "none")).toBe("direct");
    expect(strongerUsage("root", "direct")).toBe("direct");
  });
  it("root beats none", () => {
    expect(strongerUsage("none", "root")).toBe("root");
  });
  it("is symmetric for equal ranks", () => {
    expect(strongerUsage("direct", "direct")).toBe("direct");
    expect(strongerUsage("none", "none")).toBe("none");
  });
});
