"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentDetail } from "@scoutui/web-shared";
import {
  copyListText,
  emptyText,
  filterText,
  nextUsageSort,
  plural,
  togglePick,
  type UsageSection,
  type UsageValue,
  type UsageView,
  usageDue,
  usageIndex,
  usageView,
  valueColumns,
} from "@scoutui/web-shared/client";
import { type SourceRef, sourceFileUrl } from "@/lib/source-link";
import { KeptProvider, useKept, useKeptPlace, useUsageFilters } from "@/lib/usage-url";
import { FileTable } from "./file-table";
import { NoCalls } from "./no-calls";
import { areaFilterKey, propFilterKey, UsageColumn, valueFilterKey } from "./usage-column";
import { pinLine, showColumn, typing, useCharWidth, useElementWidth, useMedia, usePinTop, useSteadyStrip, useStickyColumn } from "./usage-layout-hooks";
import { FilterPills, LINK, UsageToolbar } from "./usage-toolbar";

/** md: from here the file list has its header and value columns. */
const MEDIUM = "(min-width: 48rem)";
/** lg: from here the column sits beside the files. */
const WIDE = "(min-width: 64rem)";
/** What the chevron (40px), Calls (80px) and the narrowest File column (256px) take from the file list's width. */
const TAKEN_PX = 40 + 80 + 256;
/** The Copy button that last copied, `folder` null for the toolbar's, and how many files it copied. */
type Copied = { folder: string | null; files: number };
/** How long a Copy button reads "Copied". */
const COPIED_MS = 1800;

/** The column row in `root` whose `data-filter` is `key`. */
function filterRow(root: HTMLElement | null, key: string): HTMLElement | null {
  return [...(root?.querySelectorAll<HTMLElement>("[data-filter]") ?? [])].find((el) => el.getAttribute("data-filter") === key) ?? null;
}

/**
 * The Usage tab: where a component is called, or for one with no calls, what it declares. Back after "Rendered by"
 * returns to the rows, props and scroll position the reader left.
 */
export function UsageTab({ detail, source }: { detail: ComponentDetail; source: SourceRef | null }) {
  const kept = useKeptPlace(detail.componentId);
  useLayoutEffect(() => {
    if (kept.restored) window.scrollTo({ top: kept.restored.y, behavior: "instant" });
  }, [kept]);
  if (detail.occurrences.length === 0) return <NoCalls detail={detail} source={source} />;
  return (
    <KeptProvider value={kept}>
      <Usage detail={detail} source={source} />
    </KeptProvider>
  );
}

/** Where a component is called: its files under the filters in the page URL. */
function Usage({ detail, source }: { detail: ComponentDetail; source: SourceRef | null }) {
  const index = useMemo(() => usageIndex(detail), [detail]);
  const due = usageDue(detail.deprecated, detail.migrationStatus);
  const { filters, setFind, setArea, setPicks, setSort, clearFilters } = useUsageFilters();
  const rootRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const scrollByRef = useRef<((dy: number) => void) | null>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const medium = useMedia(MEDIUM);
  const wide = useMedia(WIDE);
  const filesWidth = useElementWidth(filesRef);
  const chPx = useCharWidth(probeRef);
  const room = medium ? filesWidth - TAKEN_PX : 0;
  const columns = useMemo(() => valueColumns(index, filters.picks, room, chPx), [index, filters.picks, room, chPx]);
  // The props each file's JSX line shows below md: every prop that could be a column, whatever the room.
  const lineProps = useMemo(() => valueColumns(index, filters.picks, Number.POSITIVE_INFINITY, 1).map((c) => c.prop), [index, filters.picks]);
  // Keyed by the props shown, so a resize that keeps the same columns keeps the view.
  const shown = columns.map((c) => c.prop).join("\n");
  const view = useMemo(() => usageView(index, filters, shown ? shown.split("\n") : [], lineProps), [index, filters, shown, lineProps]);
  const stripRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Whether the filter column is open where it folds above the files, below lg.
  const [columnOpen, setColumnOpen] = useKept("columnOpen", false);
  usePinTop(rootRef, barRef);
  useStickyColumn(wide && !index.few, columnRef, spacerRef, barRef, filesRef, scrollByRef);
  useSteadyStrip(stripRef, barRef, scrollByRef);

  // `/` focuses the search and `f` the filters, from anywhere on the page but a text field. From lg `f` focuses Find a
  // prop, or the first prop line when there's none; below lg it does what the Filter button does.
  useEffect(() => {
    if (index.few) return;
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.key === "/" && searchRef.current) {
        e.preventDefault();
        searchRef.current.focus();
        searchRef.current.select();
      } else if (e.key === "f" && !e.defaultPrevented) {
        e.preventDefault();
        if (!window.matchMedia(WIDE).matches) showColumn(columnRef.current, () => setColumnOpen(true));
        else (document.getElementById("usage-find-prop") ?? columnRef.current?.querySelector<HTMLElement>(`button[data-filter^="${propFilterKey("")}"]`))?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index.few, setColumnOpen]);

  // What a change does once the view it leaves has rendered. Declared after useStickyColumn, so it runs once the column
  // has settled.
  const pending = useRef<{ from: UsageView; run: () => void } | null>(null);
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p || p.from === view) return;
    pending.current = null;
    p.run();
  }, [view]);
  const afterChange = (run: () => void) => {
    pending.current = { from: view, run };
  };

  // After a pill's ×, focus goes to the pill in its place, else the one before it, else the search; after Clear
  // filters or Clear search, to the search. Neither moves the page.
  const refocus = (to: number | "search") =>
    afterChange(() => {
      const pills = [...(stripRef.current?.querySelectorAll<HTMLElement>("[data-pill]") ?? [])];
      const pill = typeof to === "number" ? (pills[to] ?? pills[to - 1]) : undefined;
      (pill ?? searchRef.current ?? filesRef.current)?.focus({ preventScroll: true });
    });
  const clearAll = () => {
    refocus("search");
    clearFilters();
  };
  const clearSearch = () => {
    refocus("search");
    setFind("");
  };

  // A pick in the column, `key` the pressed row's and `fallback` the row that takes its place if it goes. From lg, a pick
  // that adds a filter lands: the list shows from its start when that has scrolled above the pin line, unless that would
  // put the pressed row outside the window, and focus goes to the pressed row, else the row in its place, else the
  // files. Below lg, the page scrolls by however far the pressed row, or the row in its place, moved. Focus that was on
  // the pressed row goes to the row in its place when it has gone.
  const pressed = (key: string, fallback: string | null, adding: boolean) => {
    const before = filterRow(columnRef.current, key);
    const top = before?.getBoundingClientRect().top ?? 0;
    const focused = before !== null && before === document.activeElement;
    const land = adding && wide;
    const hold = !wide;
    afterChange(() => {
      const row = filterRow(columnRef.current, key) ?? (fallback === null ? null : filterRow(columnRef.current, fallback));
      const files = filesRef.current;
      if (land) {
        const bar = barRef.current;
        const y = window.scrollY;
        if (files && bar && files.getBoundingClientRect().top < pinLine(bar) - 1) files.scrollIntoView({ block: "start", behavior: "instant" });
        (row ?? files)?.focus({ preventScroll: true });
        const box = row?.getBoundingClientRect();
        if (bar && box && (box.top < pinLine(bar) || box.bottom > window.innerHeight)) window.scrollTo({ top: y, behavior: "instant" });
        return;
      }
      if (!row) return;
      const moved = row.getBoundingClientRect().top - top;
      if (hold && moved) window.scrollBy({ top: moved, behavior: "instant" });
      if (focused && document.activeElement !== row) row.focus({ preventScroll: true });
    });
  };
  const pickValue = (prop: string, value: UsageValue) => {
    const pick = { prop, kind: value.kind, label: value.label };
    pressed(valueFilterKey(pick), propFilterKey(prop), !value.picked);
    setPicks(togglePick(filters.picks, pick));
  };
  const pickArea = (area: string | null) => {
    const key = area ?? filters.area;
    if (key !== null) pressed(areaFilterKey(key), areaFilterKey(""), area !== null);
    setArea(area);
  };

  const [copied, setCopied] = useState<Copied | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  /** Copies `sections`: every section in view from the toolbar, or one folder's or package's from its heading. */
  const copyList = (sections: readonly UsageSection[], folder: string | null) => {
    const text = copyListText({
      sections,
      displayName: detail.displayName,
      repoId: detail.repoId,
      deprecated: detail.deprecated,
      migrationStatus: detail.migrationStatus,
      byPackage: view.byPackage,
      folderKey: folder,
      filters: filterText(filters.picks, filters.area, filters.find, undefined, view.byPackage),
      href: window.location.href,
      urlFor: (path, line) => (source ? sourceFileUrl(source.remote, source.commit, path, line) : null),
    });
    const files = sections.reduce((n, section) => n + section.files.length, 0);
    void navigator.clipboard.writeText(text).then(() => {
      clearTimeout(copiedTimer.current);
      setCopied({ folder, files });
      copiedTimer.current = setTimeout(() => setCopied(null), COPIED_MS);
    });
  };
  const empty = emptyText(view);

  return (
    // With scroll anchoring off, a list that changes size leaves the page's scroll position as it is.
    <div ref={rootRef} className="panel overflow-clip [overflow-anchor:none]">
      <a
        href="#usage-files"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:z-40 focus-visible:m-2 focus-visible:rounded-md focus-visible:bg-card focus-visible:px-2 focus-visible:py-1 focus-visible:text-xs focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        Skip to files
      </a>
      {/* From lg the column sits beside the files and stays in view as the page scrolls; below lg it folds away above them. */}
      <div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[22rem_minmax(0,1fr)]">
        <UsageColumn
          view={view}
          prefix={index.prefix}
          onArea={pickArea}
          onPick={pickValue}
          due={due}
          open={columnOpen}
          onOpenChange={setColumnOpen}
          columnRef={columnRef}
          spacerRef={spacerRef}
        />
        <div ref={filesRef} id="usage-files" tabIndex={-1} className="min-w-0 outline-none lg:border-l" style={{ scrollMarginTop: "var(--pin-top, 3.5rem)" }}>
          <h2 className="sr-only">Files</h2>
          {/* Ten characters of the face the value columns are set in, to measure the width of one. */}
          <span ref={probeRef} aria-hidden className="pointer-events-none invisible absolute whitespace-nowrap font-mono text-xs">
            0000000000
          </span>
          <UsageToolbar
            view={view}
            few={index.few}
            due={due}
            width={filesWidth}
            find={filters.find}
            onFind={setFind}
            barRef={barRef}
            searchRef={searchRef}
            onFilter={() => showColumn(columnRef.current, () => setColumnOpen(true))}
            onClearFilters={clearAll}
            onCopy={() => copyList(view.sections, null)}
            copied={copied?.folder === null}
          />
          {/* The filter pills sit at the top of the list and scroll away with it. */}
          <div ref={stripRef}>
            {view.active > 0 ? (
              <FilterPills
                view={view}
                picks={filters.picks}
                onRemoveProp={(prop) => setPicks(filters.picks.filter((p) => p.prop !== prop))}
                onRemoveArea={() => setArea(null)}
                onRemoving={refocus}
                onClearFilters={clearAll}
              />
            ) : null}
          </div>
          {empty !== null ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {empty}{" "}
              <span className="inline-flex gap-3">
                {view.searched ? (
                  <button type="button" onClick={clearSearch} className={LINK}>
                    Clear search
                  </button>
                ) : null}
                {view.active > 0 ? (
                  <button type="button" onClick={clearAll} className={LINK}>
                    Clear filters
                  </button>
                ) : null}
              </span>
            </p>
          ) : (
            <FileTable
              view={view}
              few={index.few}
              source={source}
              columns={columns}
              onSort={(key) => setSort(nextUsageSort(view.sort, key))}
              copiedFolder={copied?.folder ?? null}
              onCopyFolder={(section) => copyList([section], section.key)}
            />
          )}
        </div>
      </div>
      <span aria-live="polite" className="sr-only">
        {copied !== null ? `Copied the list of ${plural(copied.files, "file")}` : ""}
      </span>
    </div>
  );
}
