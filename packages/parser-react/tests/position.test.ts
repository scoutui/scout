import { describe, it, expect } from "vitest";
import { positionAt } from "../src/position.js";

describe("positionAt", () => {
  it("converts an offset to a line and column, both counted from 1", () => {
    const source = "line one\nline two\nline three";
    expect(positionAt(source, 0)).toEqual({ line: 1, column: 1 });
    expect(positionAt(source, 9)).toEqual({ line: 2, column: 1 }); // 'l' of "line two"
    expect(positionAt(source, 18)).toEqual({ line: 3, column: 1 }); // 'l' of "line three"
    expect(positionAt(source, 4)).toEqual({ line: 1, column: 5 }); // ' ' between "line" and "one"
  });

  it("handles end-of-source offsets", () => {
    const source = "abc";
    expect(positionAt(source, 3)).toEqual({ line: 1, column: 4 });
  });

  it("handles Windows line endings", () => {
    const source = "line one\r\nline two";
    expect(positionAt(source, 10)).toEqual({ line: 2, column: 1 });
  });

  it.each([
    { name: "a lone \\r ends a line", source: "one\rtwo", offset: 4, expected: { line: 2, column: 1 } },
    { name: "the last line has no line ending", source: "one\ntwo", offset: 6, expected: { line: 2, column: 3 } },
    { name: "an offset past the end stops at the end", source: "one\ntwo", offset: 99, expected: { line: 2, column: 4 } },
    { name: "an empty source is one empty line", source: "", offset: 0, expected: { line: 1, column: 1 } },
  ])("$name", ({ source, offset, expected }) => {
    expect(positionAt(source, offset)).toEqual(expected);
  });

  it("gives each source its own positions when calls alternate between sources", () => {
    const first = "a\nb\nc";
    const second = "abcde";
    expect(positionAt(first, 4)).toEqual({ line: 3, column: 1 });
    expect(positionAt(second, 4)).toEqual({ line: 1, column: 5 });
    expect(positionAt(first, 2)).toEqual({ line: 2, column: 1 });
  });

  it("converts many offsets in a large source in time linear in its length", () => {
    const source = `${"x".repeat(999)}\n`.repeat(2_000);
    const step = source.length / 5_000;
    const started = performance.now();
    for (let offset = 0; offset < source.length; offset += step) positionAt(source, offset);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(positionAt(source, 1_500_007)).toEqual({ line: 1_501, column: 8 });
  });
});
