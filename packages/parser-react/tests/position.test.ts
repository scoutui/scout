import { describe, it, expect } from "vitest";
import { positionAt } from "../src/position.js";

describe("positionAt", () => {
  it("converts offset to 1-indexed line and 0-indexed column", () => {
    const source = "line one\nline two\nline three";
    expect(positionAt(source, 0)).toEqual({ line: 1, column: 0 });
    expect(positionAt(source, 9)).toEqual({ line: 2, column: 0 }); // 'l' of "line two"
    expect(positionAt(source, 18)).toEqual({ line: 3, column: 0 }); // 'l' of "line three"
    expect(positionAt(source, 4)).toEqual({ line: 1, column: 4 }); // ' ' between "line" and "one"
  });

  it("handles end-of-source offsets", () => {
    const source = "abc";
    expect(positionAt(source, 3)).toEqual({ line: 1, column: 3 });
  });

  it("handles Windows line endings", () => {
    const source = "line one\r\nline two";
    expect(positionAt(source, 10)).toEqual({ line: 2, column: 0 });
  });
});
