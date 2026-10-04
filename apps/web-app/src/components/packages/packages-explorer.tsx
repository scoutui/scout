"use client";

import { useMemo } from "react";
import type { PackageSummary } from "@scoutui/web-shared";
import { PackageFilterBar } from "@/components/packages/package-filter-bar";
import { PackagesTable } from "@/components/packages/packages-table";
import { useQueryParamsState } from "@/lib/use-query-synced-state";
import {
  emptyPackageFacets,
  filterPackageRows,
  PACKAGE_FACET_PARAMS,
  packageFacetOptions,
  packageFacetsToParams,
  paramsToPackageFacets,
  type PackageFacetState,
} from "@/lib/package-facets";

/**
 * Client-side faceted explorer over the full package list. The server ships
 * every row once and filtering runs here; facet state lives in the URL via
 * useQueryParamsState and writes back through history.replaceState.
 */
export function PackagesExplorer({
  rows,
  canEdit,
}: {
  rows: PackageSummary[];
  canEdit: boolean;
}) {
  const [facets, setFacets] = useQueryParamsState<PackageFacetState>(PACKAGE_FACET_PARAMS, paramsToPackageFacets, packageFacetsToParams);

  // Counted under every other active filter, as on the repo page.
  const options = useMemo(() => packageFacetOptions(rows, facets), [rows, facets]);
  const filtered = useMemo(() => filterPackageRows(rows, facets), [rows, facets]);

  return (
    <div className="panel overflow-hidden">
      <PackageFilterBar facets={facets} onChange={setFacets} options={options} resultCount={filtered.length} canEdit={canEdit} />
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">No packages match these filters.</p>
          <button
            type="button"
            onClick={() => setFacets(emptyPackageFacets())}
            className="inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <PackagesTable rows={filtered} deprecatedOnly={facets.deprecated === true} />
      )}
    </div>
  );
}
