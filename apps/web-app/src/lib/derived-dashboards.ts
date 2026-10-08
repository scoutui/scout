import type { DashboardScope } from "@scoutui/web-shared";
import { hrefWithQuery } from "@/lib/query-string";

/** Derived, non-editable chart ids: governance-derived detail pages
 *  (`migration:<recordId>` / `retirement:<recordId>`) are projections of a
 *  governance record, managed by deleting that record, never as saved dashboards. */
export function isDerivedId(id: string): boolean {
  return id.startsWith("migration:") || id.startsWith("retirement:");
}

/** A derived chart's page, across every repo or in the one repo `scope` names. */
export function derivedChartHref(id: string, scope: DashboardScope): string {
  return hrefWithQuery(`/charts/${encodeURIComponent(id)}`, scope.kind === "repo" ? [["repo", scope.repoId]] : []);
}
