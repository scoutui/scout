"use client";

import { useMemo } from "react";
import type { ComponentRow, ScanDiff } from "@scoutui/web-shared";
import { scanDiffRowCount } from "@scoutui/web-shared/client";
import { ghostRow } from "@/lib/scan-diff-view";
import { ComponentsTable } from "@/components/repos/components-table";
import { FilterBar } from "@/components/repos/filter-bar";
import { useQuerySyncedState } from "@/lib/use-query-synced-state";
import {
  emptyFacets,
  facetOptions,
  facetsToQuery,
  filterRows,
  isFiltering,
  queryToFacets,
  type FacetState,
} from "@/lib/component-facets";

/**
 * Client-side faceted explorer over the repo's full component set. The server
 * ships every row once and filtering runs here. Facet state derives from `?q=`
 * (via useQuerySyncedState) and writes back with history.replaceState, so a
 * URL stays shareable and the liqe DSL keeps working.
 */
export function ComponentsExplorer({
  repoId,
  rows,
  diff,
}: {
  repoId: string;
  rows: ComponentRow[];
  /** The shown scan vs the one before; null on a first scan. */
  diff: ScanDiff | null;
}) {
  const [facets, setFacets] = useQuerySyncedState<FacetState>(queryToFacets, facetsToQuery);

  // `changed:true` swaps the candidates for the marked current rows plus the
  // previous scan's removed rows, and every other facet applies on top. On a
  // first scan or a deprecated-only move it narrows nothing, as on `/repos`.
  const changedRows = useMemo(
    () =>
      diff === null || scanDiffRowCount(diff) === 0
        ? null
        : [...rows.filter((r) => diff.marks[r.componentId] !== undefined), ...diff.removedRows.map(ghostRow)],
    [rows, diff],
  );
  const changedActive = facets.changed && changedRows !== null;
  const candidates = facets.changed ? (changedRows ?? rows) : rows;
  // Counted over what the table filters, under every other active filter.
  const options = useMemo(() => facetOptions(rows, changedRows, facets), [rows, changedRows, facets]);
  const filtered = useMemo(() => filterRows(candidates, facets), [candidates, facets]);
  // The changed view's toolbar breakdown, `12 of 29 moved · 2 removed ·
  // 10 changed`, counted from the shown rows' marks.
  const diffShown = useMemo(() => {
    if (!changedActive || diff === null) return null;
    const counts = { total: scanDiffRowCount(diff), added: 0, removed: 0, changed: 0 };
    for (const r of filtered) {
      const kind = diff.marks[r.componentId]?.kind;
      if (kind !== undefined) counts[kind]++;
    }
    return counts;
  }, [filtered, changedActive, diff]);

  return (
    <div className="panel overflow-hidden">
      <FilterBar
        facets={facets}
        onChange={setFacets}
        options={options}
        resultCount={filtered.length}
        total={rows.length}
        diffShown={diffShown}
        filtering={isFiltering({ ...facets, changed: false })}
      />
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">No components match these filters.</p>
          <button
            type="button"
            onClick={() => setFacets(emptyFacets())}
            className="inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ComponentsTable
          key={changedActive ? "changed" : "all"}
          repoId={repoId}
          rows={filtered}
          marks={changedActive && diff !== null ? diff.marks : undefined}
          search={facets.text}
        />
      )}
    </div>
  );
}
