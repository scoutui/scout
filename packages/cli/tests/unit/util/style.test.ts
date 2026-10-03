import { describe, it, expect } from "vitest";
import { colorDepth, colorEnabled, createColor, symbol, terminalStyle } from "../../../src/util/style.js";

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
    expect(c.bold("n")).toBe("\x1b[1mn\x1b[0m");
    expect(c.dim("m")).toBe("\x1b[2mm\x1b[0m");
    expect(c.brand("")).toBe("");
  });
});

describe("brand colour", () => {
  it.each([
    [{ COLORTERM: "truecolor" }, "\x1b[38;2;7;154;153mscout\x1b[0m"],
    [{ TERM: "xterm-256color" }, "\x1b[38;5;30mscout\x1b[0m"],
    [{}, "\x1b[36mscout\x1b[0m"],
  ])("is Scout's teal at the depth the terminal supports (%j)", (env, out) => {
    expect(createColor({ isTTY: true, env }).brand("scout")).toBe(out);
  });
});

describe("colorDepth", () => {
  it.each([
    [{}, "16"],
    [{ TERM: "xterm-256color" }, "256"],
    [{ COLORTERM: "truecolor" }, "truecolor"],
    [{ COLORTERM: "24bit" }, "truecolor"],
    [{ FORCE_COLOR: "2" }, "256"],
    [{ FORCE_COLOR: "3" }, "truecolor"],
  ])("reads %j as %s", (env, depth) => {
    expect(colorDepth(env)).toBe(depth);
  });
});

describe("terminalStyle", () => {
  const tty = { isTTY: true };
  const piped = { isTTY: false };
  it.each([
    ["all three streams are terminals", {}, [tty, tty, tty], { interactive: true, styled: true, color: true }],
    ["CI is set", { CI: "1" }, [tty, tty, tty], { interactive: false, styled: false, color: false }],
    ["stdin isn't a terminal", {}, [piped, tty, tty], { interactive: false, styled: false, color: false }],
    ["stdout is piped", {}, [tty, piped, tty], { interactive: false, styled: false, color: false }],
    ["stderr is piped", {}, [tty, tty, piped], { interactive: false, styled: false, color: false }],
    ["NO_COLOR is set in a terminal", { NO_COLOR: "1" }, [tty, tty, tty], { interactive: true, styled: false, color: false }],
    ["FORCE_COLOR is set with everything piped", { FORCE_COLOR: "1" }, [piped, piped, piped], { interactive: false, styled: false, color: true }],
  ] as const)("when %s", (_case, env, [stdin, stdout, stderr], expected) => {
    const style = terminalStyle({ env, stdin, stdout, stderr });
    expect({ interactive: style.interactive, styled: style.styled, color: style.color.enabled }).toEqual(expected);
  });
});

describe("symbol", () => {
  it.each([
    ["success", "\x1b[32m✓\x1b[0m"],
    ["warning", "\x1b[33m!\x1b[0m"],
    ["error", "\x1b[31m✗\x1b[0m"],
  ] as const)("marks a %s in its status colour", (kind, out) => {
    expect(symbol(createColor({ isTTY: true, env: {} }), kind)).toBe(out);
  });
});
