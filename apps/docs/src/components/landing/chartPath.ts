type Point = readonly [number, number];

/** Maps a series of values onto points in a 0 to 100 box: x spread evenly, y from 0 at the bottom to `max` at the top. */
export function toPoints(values: readonly number[], max: number): Point[] {
  const last = Math.max(values.length - 1, 1);
  return values.map((v, i) => [(i / last) * 100, (1 - v / max) * 100] as const);
}

/** Straight segments through the points, for series that hold flat and then step. */
export function straightPath(points: readonly Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${round(x)},${round(y)}`).join("");
}

/** The line closed down to the baseline, for the area wash under a series. */
export function areaPath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${straightPath(points)}L${round(last[0])},100L${round(first[0])},100Z`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
