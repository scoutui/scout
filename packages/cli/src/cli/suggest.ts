/** Levenshtein edit distance between two strings. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev: number[] = [];
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    prev = curr;
  }
  return prev[n] ?? 0;
}

/** Closest candidate within `maxDistance` edits, or undefined. */
export function nearestMatch(
  input: string,
  candidates: readonly string[],
  maxDistance = 2,
): string | undefined {
  let best: string | undefined;
  let bestDist = maxDistance + 1;
  for (const candidate of candidates) {
    const d = editDistance(input, candidate);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
}
