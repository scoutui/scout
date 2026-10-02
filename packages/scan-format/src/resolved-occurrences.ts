import type { Occurrence, ResolvedOccurrence } from "./schema.js";

export function isResolved(o: Occurrence): o is ResolvedOccurrence {
  return o.resolution.status === "resolved";
}

/** The only way component-facing code reads occurrences: unresolved ones have no component. */
export function resolvedOccurrences(occurrences: readonly Occurrence[]): ResolvedOccurrence[] {
  return occurrences.filter(isResolved);
}
