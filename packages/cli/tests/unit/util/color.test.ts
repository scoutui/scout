import { describe, it, expect } from "vitest";
import { colorEnabled, createColor } from "../../../src/util/color.js";

describe("colorEnabled", () => {
  it("is off when NO_COLOR is set (any non-empty value)", () => {
    expect(colorEnabled({ isTTY: true, env: { NO_COLOR: "1" } })).toBe(false);
  });
  it("is on when FORCE_COLOR is set even without a TTY", () => {
    expect(colorEnabled({ isTTY: false, env: { FORCE_COLOR: "1" } })).toBe(true);
  });
  it("otherwise follows the TTY flag", () => {
    expect(colorEnabled({ isTTY: true, env: {} })).toBe(true);
    expect(colorEnabled({ isTTY: false, env: {} })).toBe(false);
  });
  it("lets NO_COLOR win over FORCE_COLOR", () => {
    expect(colorEnabled({ isTTY: true, env: { NO_COLOR: "1", FORCE_COLOR: "1" } })).toBe(false);
  });
});

describe("createColor", () => {
  it("returns the input unchanged when disabled", () => {
    const c = createColor({ isTTY: false, env: {} });
    expect(c.green("ok")).toBe("ok");
    expect(c.dim("meta")).toBe("meta");
  });
  it("wraps with ANSI codes when enabled", () => {
    const c = createColor({ isTTY: true, env: {} });
    expect(c.green("ok")).toBe("\x1b[32mok\x1b[0m");
    expect(c.red("bad")).toBe("\x1b[31mbad\x1b[0m");
    expect(c.yellow("wait")).toBe("\x1b[33mwait\x1b[0m");
    expect(c.cyan("mark")).toBe("\x1b[36mmark\x1b[0m");
    expect(c.bold("n")).toBe("\x1b[1mn\x1b[0m");
    expect(c.dim("m")).toBe("\x1b[2mm\x1b[0m");
  });
});
