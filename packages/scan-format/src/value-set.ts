/**
 * A prop's value set as a component's totals and the dashboard list it: each value once, sorted by its text with
 * `localeCompare`, so `x ? "small" : "medium"` and `x ? "medium" : "small"` both give `["medium", "small"]`.
 */
export function canonicalValueSet(values: readonly (string | number | boolean)[]): (string | number | boolean)[] {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
}
