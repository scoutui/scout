// Client-side faceted filtering for the packages list, on the same model as
// `component-facets.ts`: the server sends every row once, filtering runs locally,
// and state is kept in the page URL so it stays shareable. AND across facets, OR
// within.

import type { PackageSummary } from "@scoutui/web-shared";
import { hrefWithQuery, type QueryParams } from "@/lib/query-string";

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

// --- URL params ---------------------------------------------------------------

/** The params the packages list keeps its facets in. */
export const PACKAGE_FACET_PARAMS = ["q", "tag", "versions", "deprecated"];

export function packageFacetsToParams(f: PackageFacetState): QueryParams {
  const params: [string, string][] = [];
  if (f.text.trim() !== "") params.push(["q", f.text]);
  for (const tag of f.tags) params.push(["tag", tag]);
  if (f.versions !== null) params.push(["versions", f.versions]);
  if (f.deprecated !== null) params.push(["deprecated", String(f.deprecated)]);
  return params;
}

/** Facet state from the URL. Values it doesn't know are skipped. */
export function paramsToPackageFacets(params: URLSearchParams): PackageFacetState {
  const f = emptyPackageFacets();
  f.text = params.get("q") ?? "";
  f.tags = [...new Set(params.getAll("tag"))].filter(Boolean);
  const versions = params.get("versions");
  if (versions === "multi" || versions === "single" || versions === "unversioned") f.versions = versions;
  const deprecated = params.get("deprecated");
  if (deprecated === "true" || deprecated === "false") f.deprecated = deprecated === "true";
  return f;
}

/** A package page's components table: name search and deprecated-only. */
export type PackageComponentFilters = { text: string; deprecated: boolean };

export const PACKAGE_COMPONENT_FILTER_PARAMS = ["q", "deprecated"];

export function packageComponentFiltersToParams(f: PackageComponentFilters): QueryParams {
  const params: [string, string][] = [];
  if (f.text.trim() !== "") params.push(["q", f.text]);
  if (f.deprecated) params.push(["deprecated", "true"]);
  return params;
}

export function paramsToPackageComponentFilters(params: URLSearchParams): PackageComponentFilters {
  return { text: params.get("q") ?? "", deprecated: params.get("deprecated") === "true" };
}

/** A link to a package's page showing only its deprecated components. */
export function deprecatedComponentsHref(packageName: string): string {
  return hrefWithQuery(`/packages/${encodeURIComponent(packageName)}`, packageComponentFiltersToParams({ text: "", deprecated: true }));
}
