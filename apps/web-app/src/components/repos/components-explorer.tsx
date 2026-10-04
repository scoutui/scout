"use client";

import { useMemo } from "react";
import type { ComponentRow, ScanDiff } from "@scoutui/web-shared";
import { scanDiffRowCount } from "@scoutui/web-shared/client";
import { ghostRow } from "@/lib/scan-diff-view";
import { ComponentsTable } from "@/components/repos/components-table";
import { FilterBar } from "@/components/repos/filter-bar";
import { useQueryParamsState } from "@/lib/use-query-synced-state";
import {
  emptyFacets,
  FACET_PARAMS,
  facetOptions,
  facetsToParams,
  filterRows,
  isFiltering,
  paramsToFacets,
  rowsUsedIn,
  usedInOptions,
  type FacetState,
} from "@/lib/component-facets";

/**
 * Client-side faceted explorer over the repo's full component set. The server
 * ships every row once and filtering runs here. Facet state lives in the URL
 * (via useQueryParamsState) and writes back with history.replaceState, so a
 * URL stays shareable.
 */
export function ComponentsExplorer({
  repoId,
  rows,
  notInLatest,
  deprecatedTotal,
  diff,
  packages,
  canEdit,
}: {
  repoId: string;
  rows: ComponentRow[];
  /** Ids of the shown scan's components that the latest scan doesn't have. */
  notInLatest?: string[] | undefined;
  deprecatedTotal: number;
  /** The shown scan vs the one before; null on a first scan. */
  diff: ScanDiff | null;
  /** The scan's packages, each with its folder. */
  packages: ReadonlyArray<{ name: string; folder: string }>;
  canEdit: boolean;
}) {
  const notInLatestIds = useMemo(() => new Set(notInLatest), [notInLatest]);
  const [facets, setFacets] = useQueryParamsState<FacetState>(FACET_PARAMS, paramsToFacets, facetsToParams);

  // `usedIn` narrows the rows to one package's, with that package's uses and
  // files, before every other facet, count and sort.
  const scoped = useMemo(() => (facets.usedIn ? rowsUsedIn(rows, facets.usedIn) : rows), [rows, facets.usedIn]);
  // `changed` swaps the candidates for the marked current rows plus the
  // previous scan's removed rows, and every other facet applies on top. On a
  // first scan or a deprecated-only move it narrows nothing, as on `/repos`,
  // and under `usedIn` there is no changed view.
  const changedRows = useMemo(
    () =>
      facets.usedIn || diff === null || scanDiffRowCount(diff) === 0
        ? null
        : [...rows.filter((r) => diff.marks[r.componentId] !== undefined), ...diff.removedRows.map(ghostRow)],
    [rows, diff, facets.usedIn],
  );
  const changedActive = facets.changed && changedRows !== null;
  const candidates = facets.changed && changedRows !== null ? changedRows : scoped;
  // Counted over what the table filters, under every other active filter.
  const options = useMemo(() => facetOptions(scoped, changedRows, facets), [scoped, changedRows, facets]);
  const usedIn = useMemo(() => usedInOptions(rows, facets), [rows, facets]);
  const filtered = useMemo(() => filterRows(candidates, facets), [candidates, facets]);
  const packageFolders = useMemo(() => new Map(packages.map((p) => [p.name, p.folder])), [packages]);
  // The changed view's toolbar breakdown, `12 of 29 changes · 2 removed ·
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
        usedIn={usedIn}
        packageFolders={packageFolders}
        resultCount={filtered.length}
        total={scoped.length}
        deprecatedTotal={facets.usedIn ? scoped.filter((r) => r.deprecated).length : deprecatedTotal}
        diffShown={diffShown}
        filtering={isFiltering({ ...facets, changed: false, usedIn: null })}
        canEdit={canEdit}
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
          notInLatest={notInLatestIds}
          search={facets.text}
          usedIn={facets.usedIn}
        />
      )}
    </div>
  );
}
