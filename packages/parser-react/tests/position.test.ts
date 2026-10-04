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
});
