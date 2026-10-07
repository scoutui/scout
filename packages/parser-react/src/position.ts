export type Position = { line: number; column: number };

const LF = 10;
const CR = 13;

let indexedSource: string | undefined;
let indexedLineStarts: readonly number[] = [0];

/** The offset where each line starts. `\r\n`, `\n` and a lone `\r` each end a line. */
function lineStartsOf(source: string): readonly number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    const char = source.charCodeAt(i);
    if (char === LF || (char === CR && source.charCodeAt(i + 1) !== LF)) starts.push(i + 1);
  }
  return starts;
}

/** The line starts of `source`, reused while calls stay on the same source. */
function cachedLineStartsOf(source: string): readonly number[] {
  if (source !== indexedSource) {
    indexedSource = source;
    indexedLineStarts = lineStartsOf(source);
  }
  return indexedLineStarts;
}

/** The index of the last line that starts at or before `offset`. */
function lineIndexAt(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Convert a UTF-16 code unit offset (as emitted by oxc-parser) into a
 * 1-indexed line + 1-indexed column position. An offset past the end of the
 * source gives the position at its end.
 */
export function positionAt(source: string, offset: number): Position {
  const lineStarts = cachedLineStartsOf(source);
  const end = Math.min(Math.max(offset, 0), source.length);
  const index = lineIndexAt(lineStarts, end);
  return { line: index + 1, column: end - (lineStarts[index] ?? 0) + 1 };
}
