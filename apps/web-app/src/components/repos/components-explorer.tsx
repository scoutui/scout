"use client";

import { useEffect, useMemo, useState } from "react";
import { PanelRight } from "lucide-react";
import type { ComponentRow, CrossRepoComponentDetail, ScanDiff } from "@scoutui/web-shared";
import { plural, scanDiffRowCount } from "@scoutui/web-shared/client";
import { changeText, ghostRow } from "@/lib/scan-diff-view";
import { ComponentsTable, longestPackageName, type SelectHow, typicalNameLength, useSortedRows } from "@/components/repos/components-table";
import { ComponentDetailsPanel, type PanelFactsState, type PanelMode } from "@/components/repos/component-details-panel";
import { FilterBar } from "@/components/repos/filter-bar";
import { useMedia } from "@/components/component-detail/usage/usage-layout-hooks";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Toggle } from "@/components/ui/toggle";
import type { ComponentPanelFacts } from "@/lib/component-panel";
import type { SourceRef } from "@/lib/source-link";
import { cn } from "@/lib/utils";
import { useQueryParamsState } from "@/lib/use-query-synced-state";
import {
  deprecatedInUse,
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

/** From here up the details sit beside the table; below it, they open in a bottom sheet. */
const WIDE = "(min-width: 64rem)";
/** How long the selection rests before the panel reads its details, so holding ↓ doesn't read every row. */
const SETTLE_MS = 150;

type PanelReads = { facts: Map<string, PanelFactsState>; otherRepos: Map<string, number> };

/**
 * The selected component's details beyond its row, read once it has rested, while `active`: this repo's facts from the
 * panel's route, and the other repos holding it from the cross-repo read, which reads every repo's latest scan and so
 * never holds up the rest. Each is kept for the page's life.
 */
function usePanelReads(repoId: string, scanId: string, componentId: string | null, active: boolean) {
  const [reads, setReads] = useState<PanelReads>({ facts: new Map(), otherRepos: new Map() });
  const factsKey = `${scanId}:${componentId}`;
  const needFacts = componentId !== null && !reads.facts.has(factsKey);
  const needRepos = componentId !== null && !reads.otherRepos.has(componentId);
  useEffect(() => {
    if (!active || componentId === null || (!needFacts && !needRepos)) return;
    const controller = new AbortController();
    const json = async (url: string) => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    };
    const timer = setTimeout(() => {
      if (needFacts) {
        json(`/api/repos/${encodeURIComponent(repoId)}/components/${encodeURIComponent(componentId)}?scan=${encodeURIComponent(scanId)}`)
          .then((facts: ComponentPanelFacts) => ({ state: "ready" as const, facts }), () => ({ state: "error" as const }))
          .then((state) => { if (!controller.signal.aborted) setReads((r) => ({ ...r, facts: new Map(r.facts).set(factsKey, state) })); });
      }
      if (needRepos) {
        json(`/api/components/${encodeURIComponent(componentId)}`)
          .then((detail: CrossRepoComponentDetail) => {
            const others = detail.usages.filter((usage) => usage.repoId !== repoId).length;
            if (!controller.signal.aborted) setReads((r) => ({ ...r, otherRepos: new Map(r.otherRepos).set(componentId, others) }));
          })
          .catch(() => {
            if (!controller.signal.aborted) setReads((r) => ({ ...r, otherRepos: new Map(r.otherRepos).set(componentId, 0) }));
          });
      }
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [repoId, scanId, componentId, active, factsKey, needFacts, needRepos]);
  return {
    facts: reads.facts.get(factsKey) ?? ({ state: "loading" } as const),
    otherRepos: componentId === null ? null : (reads.otherRepos.get(componentId) ?? null),
  };
}

/** What a screen reader hears when the selection changes: the name and the row's facts, never the whole panel. */
function announcement(row: ComponentRow, change: string | null): string {
  return [
    row.displayName,
    `${plural(row.occurrenceCount, "use")} in ${plural(row.fileCount, "file")}`,
    ...(change ? [change] : []),
    ...(row.deprecated ? ["Deprecated"] : []),
  ].join(". ").concat(".");
}

/**
 * Client-side faceted explorer over the repo's full component set. The server
 * ships every row once and filtering runs here. Facet state lives in the URL
 * (via useQueryParamsState) and writes back with history.replaceState, so a
 * URL stays shareable. The selected row's details sit beside the table from
 * 64rem, open on every visit; below that they open in a bottom sheet.
 */
export function ComponentsExplorer({
  repoId,
  scanId,
  rows,
  notInLatest,
  deprecatedTotal,
  diff,
  packages,
  source,
  canEdit,
}: {
  repoId: string;
  /** The shown scan. */
  scanId: string;
  rows: ComponentRow[];
  /** Ids of the shown scan's components that the latest scan doesn't have. */
  notInLatest?: string[] | undefined;
  deprecatedTotal: number;
  /** The shown scan vs the one before; null on a first scan. */
  diff: ScanDiff | null;
  /** The scan's packages, each with its folder. */
  packages: ReadonlyArray<{ name: string; folder: string }>;
  /** The shown scan's remote and commit, for source links. */
  source: SourceRef | null;
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
  // The longest package name and the typical name length over every row the table can show, whatever the filters.
  const everyRow = useMemo(() => [...rows, ...(diff?.removedRows.map(ghostRow) ?? [])], [rows, diff]);
  const packageChars = useMemo(() => longestPackageName(everyRow), [everyRow]);
  const nameChars = useMemo(() => typicalNameLength(everyRow), [everyRow]);
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
  // Each row's change since the previous scan, which the details and the
  // announcement say in both views: none on a first scan or under a Used in
  // package. The table gets it, for its Change column and ghost rows, only in
  // the changed view.
  const diffMarks = facets.usedIn || diff === null ? undefined : diff.marks;
  const marks = changedActive ? diffMarks : undefined;
  const sort = useSortedRows(filtered, marks, changedActive);

  // The selection is a component id, so it survives sorting, filtering and
  // the changed view; a row the filters remove hands it to the first row.
  // Removed rows have no details, so they can't be selected.
  const selectable = useMemo(() => sort.sorted.filter((r) => marks?.[r.componentId]?.kind !== "removed"), [sort.sorted, marks]);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const selectedIndex = Math.max(0, selectable.findIndex((r) => r.componentId === chosenId));
  const selected = selectable[selectedIndex] ?? null;

  const wide = useMedia(WIDE, true);
  const [inlineOpen, setInlineOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const mode: PanelMode = wide ? "column" : "sheet";
  const open = mode === "column" ? inlineOpen : sheetOpen;
  const setShown = mode === "column" ? setInlineOpen : setSheetOpen;
  const reads = usePanelReads(repoId, scanId, selected?.componentId ?? null, open);
  // Before mount the column is assumed and CSS hides it below 64rem; once the
  // width is known it leaves the page there.
  const column = mode === "column" && inlineOpen && selected !== null;
  const [spoken, setSpoken] = useState("");

  function select(id: string, how: SelectHow | "step") {
    const row = selectable.find((r) => r.componentId === id);
    if (!row) return;
    setChosenId(id);
    if (how === "click") setShown(true);
    setSpoken(announcement(row, diffMarks ? changeText(diffMarks[id], row.occurrenceCount) : null));
  }
  /** Shows or hides the details and says so, since focus often stays in the table. */
  function setOpen(next: boolean) {
    if (next === open) return;
    setShown(next);
    setSpoken(next && selected ? `Details shown for ${selected.displayName}` : "Details hidden");
  }
  const step = (by: number) => {
    const next = selectable[selectedIndex + by];
    return next ? () => select(next.componentId, "step") : undefined;
  };

  const panel = (inMode: PanelMode) =>
    selected ? (
      <ComponentDetailsPanel
        repoId={repoId}
        row={selected}
        linked={!notInLatestIds.has(selected.componentId)}
        usedIn={facets.usedIn}
        mark={diffMarks?.[selected.componentId]}
        showChange={diffMarks !== undefined && (inMode === "sheet" || marks === undefined)}
        facts={reads.facts}
        otherRepos={reads.otherRepos}
        source={source}
        mode={inMode}
        canEdit={canEdit}
        onPrevious={step(-1)}
        onNext={step(1)}
        onClose={() => setOpen(false)}
      />
    ) : null;

  const detailsToggle = (
    <Toggle
      variant="outline"
      size="sm"
      pressed={open}
      onPressedChange={setOpen}
      title="Show or hide details"
      className="shrink-0 gap-1.5 font-normal not-aria-pressed:border-border not-aria-pressed:bg-background max-sm:hidden dark:not-aria-pressed:border-input dark:not-aria-pressed:bg-input/30"
    >
      <PanelRight aria-hidden />
      Details
    </Toggle>
  );

  return (
    <div className={cn(column && "lg:grid lg:grid-cols-[minmax(0,1fr)_clamp(22.5rem,32vw,27.5rem)] lg:items-start lg:gap-6")}>
    <div className="panel min-w-0 overflow-hidden">
      <FilterBar
        facets={facets}
        onChange={setFacets}
        options={options}
        usedIn={usedIn}
        packageFolders={packageFolders}
        resultCount={filtered.length}
        total={scoped.length}
        deprecatedTotal={facets.usedIn ? scoped.filter(deprecatedInUse).length : deprecatedTotal}
        diffShown={diffShown}
        filtering={isFiltering({ ...facets, changed: false, usedIn: null })}
        canEdit={canEdit}
        actions={detailsToggle}
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
          repoId={repoId}
          sort={sort}
          marks={marks}
          notInLatest={notInLatestIds}
          search={facets.text}
          usedIn={facets.usedIn}
          selectedId={selected?.componentId ?? null}
          onSelect={select}
          packageChars={packageChars}
          nameChars={nameChars}
        />
      )}
    </div>
      {column && selected ? (
        <aside
          aria-label={`Details for ${selected.displayName}`}
          className="panel pin-under-top-bar hidden max-h-[calc(100dvh-var(--top-bar-height)-2rem)] overflow-y-auto p-5 [--pin-below:1rem] lg:block"
        >
          {panel("column")}
        </aside>
      ) : null}
      {mode === "sheet" ? (
        <Drawer open={sheetOpen} onOpenChange={setOpen} swipeDirection="down">
          <DrawerContent aria-label={selected ? `Details for ${selected.displayName}` : "Details"} className="px-4 pt-3 pb-6">
            {panel("sheet")}
          </DrawerContent>
        </Drawer>
      ) : null}
      <p aria-live="polite" className="sr-only">{spoken}</p>
    </div>
  );
}
