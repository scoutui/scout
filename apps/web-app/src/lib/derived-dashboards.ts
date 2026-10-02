/** Derived, non-editable chart ids: governance-derived detail pages
 *  (`migration:<recordId>` / `retirement:<recordId>`) are projections of a
 *  governance record, managed by deleting that record, never as saved dashboards. */
export function isDerivedId(id: string): boolean {
  return id.startsWith("migration:") || id.startsWith("retirement:");
}
