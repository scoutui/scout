import type { CohortSelector } from "@scoutui/web-shared";

/**
 * Conservative: only returns false when the cohorts provably cannot share components,
 * so the share caption errs toward showing. Provably-disjoint cases: the trivial
 * single series, and all-distinct single components.
 */
export function seriesCanOverlap(cohorts: CohortSelector[]): boolean {
  if (cohorts.length < 2) return false;
  const allComponents = cohorts.every((c) => c.kind === "component");
  if (allComponents) {
    const ids = cohorts.map((c) => (c as Extract<CohortSelector, { kind: "component" }>).componentId);
    return new Set(ids).size !== ids.length; // repeated id => same cohort twice
  }
  return true;
}
