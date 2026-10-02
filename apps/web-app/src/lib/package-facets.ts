// Client-side faceted filtering for the packages list, on the same model as
// `component-facets.ts`: the server sends every row once, filtering runs locally,
// and state serialises to a `?q=` liqe grammar so URLs stay shareable. AND across
// facets, OR within.

import type { PackageSummary } from "@scoutui/web-shared";
import { joinTerms, nameTerm, orGroup, readTerms } from "@/lib/query-terms";

export type VersionsValue = "multi" | "single" | "unversioned";

export type PackageFacetState = {
  text: string; // free-text search (case-insensitive substring on packageName)
  tags: string[]; // OR within (a row matches if it carries any selected tag)
  versions: VersionsValue | null; // a package is exactly one of the three, so single-select
  deprecated: boolean | null; // true = has deprecated components in use, false = none, null = any
};

export function emptyPackageFacets(): PackageFacetState {
  return { text: "", tags: [], versions: null, deprecated: null };
}

export const VERSIONS_LABEL: Record<VersionsValue, string> = {
  multi: "Multiple versions",
  single: "Single version",
  unversioned: "Unversioned",
};

export function versionsValueOf(r: PackageSummary): VersionsValue {
  if (r.distinctVersionCount === 0) return "unversioned";
  return r.distinctVersionCount === 1 ? "single" : "multi";
}

/** True when any facet is active (i.e. the row set is being narrowed). */
export function isFilteringPackages(f: PackageFacetState): boolean {
  return f.text.trim() !== "" || f.tags.length > 0 || f.versions !== null || f.deprecated !== null;
}


function matchesPackageRow(r: PackageSummary, f: PackageFacetState): boolean {
  const text = f.text.trim().toLowerCase();
  if (text && !r.packageName.toLowerCase().includes(text)) return false;
  if (f.tags.length) {
    const rowTags = r.tags ?? [];
    if (!rowTags.some((t) => f.tags.includes(t.value))) return false;
  }
  if (f.versions !== null && versionsValueOf(r) !== f.versions) return false;
  if (f.deprecated !== null && r.deprecatedCount > 0 !== f.deprecated) return false;
  return true;
}

/** Apply the facet state to the full row set. Pure; memoise at the call site. */
export function filterPackageRows(rows: PackageSummary[], f: PackageFacetState): PackageSummary[] {
  return rows.filter((r) => matchesPackageRow(r, f));
}

/** What the Filter menu and the deprecated chip offer, each value with its count. */
export type PackageFacetOptions = {
  tags: { value: string; color: string; count: number }[];
  versions: Record<VersionsValue, number>;
  deprecatedCount: number;
  /** Packages with deprecated components in use under any filters, so the chip can reserve its width. */
  deprecatedMax: number;
  total: number;
};

/**
 * Faceted counts, as `facetOptions` counts the repo page: each count is the
 * packages matching every other active filter, so a facet ignores its own
 * selection. Every tag a package carries is listed, zero counts included, and
 * so is a selected tag no package carries. Hiding zeros is the menu's job.
 */
export function packageFacetOptions(rows: readonly PackageSummary[], f: PackageFacetState): PackageFacetOptions {
  const withoutTags: PackageFacetState = { ...f, tags: [] };
  const withoutVersions: PackageFacetState = { ...f, versions: null };
  const withoutDeprecated: PackageFacetState = { ...f, deprecated: null };

  const tagCounts = new Map<string, { color: string; count: number }>(f.tags.map((t) => [t, { color: "", count: 0 }]));
  const versions = { multi: 0, single: 0, unversioned: 0 };
  let deprecatedCount = 0;

  for (const r of rows) {
    const inTags = matchesPackageRow(r, withoutTags) ? 1 : 0;
    for (const t of r.tags ?? []) {
      tagCounts.set(t.value, { color: t.color, count: (tagCounts.get(t.value)?.count ?? 0) + inTags });
    }
    if (matchesPackageRow(r, withoutVersions)) versions[versionsValueOf(r)]++;
    if (r.deprecatedCount > 0 && matchesPackageRow(r, withoutDeprecated)) deprecatedCount++;
  }

  const tags = [...tagCounts.entries()]
    .map(([value, { color, count }]) => ({ value, color, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return {
    tags,
    versions,
    deprecatedCount,
    deprecatedMax: rows.filter((r) => r.deprecatedCount > 0).length,
    total: rows.length,
  };
}

// --- URL (?q=) round-trip -----------------------------------------------------

/** Serialise facets to a liqe query string for the URL. */
export function packageFacetsToQuery(f: PackageFacetState): string {
  return joinTerms([
    nameTerm(f.text),
    orGroup("tag", f.tags),
    f.versions !== null ? `versions:${f.versions}` : "",
    f.deprecated !== null ? `deprecated:${f.deprecated}` : "",
  ]);
}

const FIELDS = ["name", "tag", "versions", "deprecated"];

/** Best-effort parse of a `?q=` string back into facet state. Lossless inverse
 *  of `packageFacetsToQuery`; tolerant reader of hand-written simple queries. */
export function queryToPackageFacets(q: string): PackageFacetState {
  const f = emptyPackageFacets();
  for (const { field, value: raw } of readTerms(q, FIELDS)) {
    switch (field) {
      case "name":
        f.text = raw;
        break;
      case "tag":
        if (!f.tags.includes(raw)) f.tags.push(raw);
        break;
      case "versions":
        if (raw === "multi" || raw === "single" || raw === "unversioned") f.versions = raw;
        break;
      case "deprecated":
        f.deprecated = raw === "true";
        break;
    }
  }
  return f;
}
