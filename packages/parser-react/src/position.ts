export type Position = { line: number; column: number };

/**
 * Convert a UTF-16 code unit offset (as emitted by oxc-parser) into a
 * 1-indexed line + 1-indexed column position. O(offset): fine for emit-time
 * use (called once per occurrence), but avoid it in tight walk loops.
 */
export function positionAt(source: string, offset: number): Position {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      column = 1;
    } else if (source[i] === "\r") {
      // \r\n counted via the next \n; lone \r increments line.
      if (source[i + 1] !== "\n") {
        line++;
        column = 1;
      }
    } else {
      column++;
    }
  }
  return { line, column };
}
