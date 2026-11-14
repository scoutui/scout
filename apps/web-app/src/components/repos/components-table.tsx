"use client";
import { type KeyboardEvent, type MouseEvent, type RefCallback, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ComponentRow, DiffMark } from "@scoutui/web-shared";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SlashBreaks } from "@/components/dashboards/cohort-label";
import { DeprecatedMark } from "@/components/deprecated-mark";
import { PackageName } from "@/components/package-name";
import { SortButton, ariaSort, sortRows, useSort } from "@/components/ui/sortable";
import { NO_PACKAGE_TITLE, writtenNameMatch } from "@/lib/component-facets";
import { componentHref, packageArea } from "@/lib/usage-url";
import { deltaOf, deltaTone, signedCount } from "@/lib/scan-diff-view";
import { sortByVersion } from "@/lib/version-order";
import { cn } from "@/lib/utils";

/** The outline badge for `added` and `removed` rows. Its border clears the 3:1
 *  non-text minimum on the panel (3.3:1 light, 3.8:1 dark); the default
 *  `--hairline` outline measured 1.21:1 on dark, and `/35` 1.4:1 on light. */
const MARK_BADGE = "shrink-0 border-muted-foreground/70 text-muted-foreground";

/** A row's name cell. In stacked rows it is the row's one visible cell and
 *  fills the table without growing past it, so a long name truncates. */
const NAME_CELL = "overflow-hidden align-middle @max-[43rem]:w-full @max-[43rem]:max-w-0";

/** A row's name line: a badge that doesn't fit beside the name wraps under it. */
const NAME_ROW = "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5";

/** Column widths in rem. Version, Files, Uses and Change fit their headers and
 *  `1,234,567` or `−12,345`. */
const WIDTH = { version: 6, files: 4.5, uses: 6, change: 6 };
/** The width Component needs, in rem: room for a typical name, at least `COMPONENT_MIN` and at most `COMPONENT_MAX`. */
const COMPONENT_MIN = 14;
const COMPONENT_MAX = 22;
/** One character of a component name (Monaspace Neon at text-sm) and of a package name (at text-xs), and the cell's padding. */
const NAME_CHAR = 0.5425;
const PACKAGE_CHAR = 0.465;
const CELL_PADDING = 1.5;
/** At least the Package header's width. */
const PACKAGE_MIN = 6.5;

/**
 * The Package column's width: enough for the longest package name, while
 * Component keeps the width a name of `nameChars` needs. Package gives way
 * first, down to `PACKAGE_MIN`, and Component takes what's left. `100cqw` is
 * the table's width.
 */
function packageWidth(packageChars: number, nameChars: number, change: boolean): string {
  const fixed = WIDTH.version + WIDTH.files + WIDTH.uses + (change ? WIDTH.change : 0);
  const component = Math.min(Math.max(nameChars * NAME_CHAR + CELL_PADDING, COMPONENT_MIN), COMPONENT_MAX);
  const content = Math.max(packageChars * PACKAGE_CHAR + CELL_PADDING, PACKAGE_MIN);
  return `max(${PACKAGE_MIN}rem, min(${content}rem, calc(100cqw - ${fixed + component}rem)))`;
}

type SortKey = "displayName" | "packageName" | "version" | "fileCount" | "occurrenceCount" | "delta";
// `delta` is not here: the Change header opens ascending (biggest drop first)
// every time, including on coming back to it from another column.
const DESC_KEYS: ReadonlySet<SortKey> = new Set(["fileCount", "occurrenceCount"]);

/**
 * The table's rows in sort order, with the sort state. Most used first; the
 * changed view opens on the change since the previous scan (`marks`), biggest
 * drop first, each time it's entered.
 */
export function useSortedRows(rows: ComponentRow[], marks: Record<string, DiffMark> | undefined, changedView: boolean) {
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>(
    changedView ? "delta" : "occurrenceCount",
    changedView ? "asc" : "desc",
    DESC_KEYS,
    changedView ? "changed" : "all",
  );
  const sorted = useMemo(
    () =>
      sortKey === "version"
        ? sortByVersion(rows, sortDir)
        : sortRows(rows, sortKey, sortDir, (r, k) => {
            if (k !== "delta") return r[k];
            // No change shows a dash, nothing to report, so it sorts last in both directions.
            const delta = deltaOf(marks?.[r.componentId], r.occurrenceCount);
            return delta === 0 ? null : delta;
          }),
    [rows, sortKey, sortDir, marks],
  );
  return { sorted, sortKey, sortDir, toggleSort };
}

export type SortedRows = ReturnType<typeof useSortedRows>;

/** How a row came to be selected: its button, by a click, Enter or Space, or ↑↓ from the row before. */
export type SelectHow = "click" | "key";

/**
 * One row per component, keyed and linked by its component id. Each row has a
 * button stretched over it, which selects the row, and a link on its name.
 * The selected row's button and name are the table's tab stops, and ↑↓ move
 * the selection and focus between rows' buttons.
 */
export function ComponentsTable({
  repoId,
  sort,
  marks,
  notInLatest,
  search,
  usedIn,
  selectedId,
  onSelect,
  packageChars = longestPackageName(sort.sorted),
  nameChars = typicalNameLength(sort.sorted),
  shortPaths,
}: {
  repoId: string;
  /** The rows in sort order and the sort state, from `useSortedRows`. */
  sort: SortedRows;
  /** componentId → scan-diff mark. Given, the table shows the Change column,
   *  badges a row marked `added`, and renders a row marked `removed` as a ghost. */
  marks?: Record<string, DiffMark> | undefined;
  /** Components the latest scan doesn't have. They have no detail page, so their rows have no link. */
  notInLatest?: ReadonlySet<string> | undefined;
  /** The search box text: a row it finds only by a written name says which. */
  search?: string;
  /** The Used in package: a row used in more than one package links to its Usage tab with this package picked. */
  usedIn?: string | null;
  selectedId?: string | null | undefined;
  onSelect?: ((componentId: string, how: SelectHow) => void) | undefined;
  /** The longest package name the Package column fits, in characters; the shown rows' longest when not given. */
  packageChars?: number | undefined;
  /** The name length the Component column makes room for, in characters; the shown rows' typical length when not given. */
  nameChars?: number | undefined;
  /** componentId → the part of the row's path that tells it from rows sharing its package and name. A row with a path and no entry shows its full path. */
  shortPaths?: ReadonlyMap<string, string> | undefined;
}) {
  const { sorted, sortKey, sortDir, toggleSort } = sort;
  const columnCount = marks ? 6 : 5;
  const selectable = (row: ComponentRow) => marks?.[row.componentId]?.kind !== "removed";
  const nameRef = useTruncatedClass();

  // Only the visible window renders: at ~1,900 rows the full render dominates
  // first load. initialRect lets the server render a first window, so the table
  // doesn't flash empty. estimateSize is the measured desktop row height;
  // measureElement corrects taller rows, such as stacked ones.
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 37,
    overscan: 12,
    initialRect: { width: 1200, height: 600 },
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const first = virtualRows[0];
  const last = virtualRows[virtualRows.length - 1];
  const paddingTop = first ? first.start : 0;
  const paddingBottom = last ? totalSize - last.end : 0;

  // The selected row's button and name are the tab stops; while it isn't
  // rendered, the first rendered row's are.
  const rendered = virtualRows.map((vr) => sorted[vr.index]).filter((row): row is ComponentRow => row !== undefined && selectable(row));
  const tabStop = rendered.some((row) => row.componentId === selectedId) ? selectedId : rendered[0]?.componentId;

  // The selected row scrolls into view when it changes, so a step from the
  // keyboard or the details panel keeps it on screen.
  const selectedIndex = sorted.findIndex((row) => row.componentId === selectedId);
  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);

  // The button of the row ↑↓ moved to takes focus once it renders.
  const focusNext = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (focusNext.current === null) return;
    const button = scrollRef.current?.querySelector<HTMLElement>(`[data-row-name="${CSS.escape(focusNext.current)}"]`);
    if (!button) return;
    focusNext.current = null;
    button.focus({ preventScroll: true });
  });

  // ↑↓ from a row's button or name.
  function onKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
    const id = (e.target as HTMLElement).closest("tr[data-row-id]")?.getAttribute("data-row-id");
    if (id == null || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    let index = sorted.findIndex((row) => row.componentId === id) + step;
    while (sorted[index] && !selectable(sorted[index] as ComponentRow)) index += step;
    const next = sorted[index];
    if (!next) return;
    focusNext.current = next.componentId;
    onSelect?.(next.componentId, "key");
  }

  // A click, Enter or Space on a row's button focuses it and selects the row.
  function onRowButtonClick(e: MouseEvent<HTMLButtonElement>, row: ComponentRow) {
    e.currentTarget.focus({ preventScroll: true });
    onSelect?.(row.componentId, "click");
  }

  // table-fixed only where the column grid exists (a table 43rem wide and up);
  // in stacked rows the single visible cell must take the full width under
  // auto layout.
  return (
    <Table containerRef={scrollRef} containerClassName="@container max-h-[70vh] overflow-y-auto" className="@min-[43rem]:table-fixed">
      {/* In a table narrower than 43rem the rows stack, so there are no headers and no sorting. */}
      <TableHeader className="sticky top-0 z-10 hidden @min-[43rem]:table-header-group">
        <TableRow>
          <TableHead aria-sort={ariaSort("displayName", sortKey, sortDir)}>
            <SortButton label="Component" sortKey="displayName" current={sortKey} dir={sortDir} onClick={toggleSort} />
          </TableHead>
          <TableHead style={{ width: packageWidth(packageChars, nameChars, marks !== undefined) }} aria-sort={ariaSort("packageName", sortKey, sortDir)}>
            <SortButton label="Package" sortKey="packageName" current={sortKey} dir={sortDir} onClick={toggleSort} />
          </TableHead>
          <TableHead style={{ width: `${WIDTH.version}rem` }} aria-sort={ariaSort("version", sortKey, sortDir)}>
            <SortButton label="Version" sortKey="version" current={sortKey} dir={sortDir} onClick={toggleSort} />
          </TableHead>
          <TableHead className="text-end" style={{ width: `${WIDTH.files}rem` }} aria-sort={ariaSort("fileCount", sortKey, sortDir)}>
            <SortButton label="Files" sortKey="fileCount" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
          </TableHead>
          <TableHead className={cn("text-end", !marks && "pe-3")} style={{ width: `${WIDTH.uses}rem` }} aria-sort={ariaSort("occurrenceCount", sortKey, sortDir)}>
            <SortButton label="Uses" sortKey="occurrenceCount" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
          </TableHead>
          {marks ? (
            <TableHead className="pe-3 text-end" style={{ width: `${WIDTH.change}rem` }} aria-sort={ariaSort("delta", sortKey, sortDir)}>
              <SortButton label="Change" title="Change since previous scan" sortKey="delta" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody onKeyDown={onKeyDown}>
        {paddingTop > 0 ? (
          <tr key="pad-top" aria-hidden>
            <td colSpan={columnCount} style={{ height: paddingTop }} />
          </tr>
        ) : null}
        {virtualRows.map(vr => {
          const row = sorted[vr.index];
          if (!row) return null;
          const mark = marks?.[row.componentId];
          if (mark?.kind === "removed") {
            return <GhostRow key={row.componentId} r={row} index={vr.index} measure={virtualizer.measureElement} nameRef={nameRef} />;
          }
          const linked = !notInLatest?.has(row.componentId);
          const selected = row.componentId === selectedId;
          return (
            <TableRow
              key={row.componentId}
              data-index={vr.index}
              data-row-id={row.componentId}
              ref={virtualizer.measureElement}
              className={cn("relative", selected ? "selected" : "hover:bg-muted/50")}
            >
              <RowCells
                r={row}
                nameRef={nameRef}
                shortPath={shortPaths?.get(row.componentId)}
                href={linked ? componentHref(repoId, row.componentId, packageArea(row.usedIn, usedIn)) : undefined}
                selected={selected}
                tabStop={row.componentId === tabStop}
                onButtonClick={(e) => onRowButtonClick(e, row)}
                mark={mark}
                showChange={marks !== undefined}
                writtenAs={search ? writtenNameMatch(row, search) : undefined}
              />
            </TableRow>
          );
        })}
        {paddingBottom > 0 ? (
          <tr key="pad-bottom" aria-hidden>
            <td colSpan={columnCount} style={{ height: paddingBottom }} />
          </tr>
        ) : null}
      </TableBody>
    </Table>
  );
}

/** The longest package name among `rows`, in characters. */
export function longestPackageName(rows: readonly ComponentRow[]): number {
  return rows.reduce((longest, r) => Math.max(longest, r.packageName?.length ?? 0), 0);
}

/** The 95th percentile of the name lengths among `rows`, in characters: 0 for no rows. */
export function typicalNameLength(rows: readonly ComponentRow[]): number {
  const lengths = rows.map((r) => r.displayName.length).sort((a, b) => a - b);
  return lengths[Math.ceil(lengths.length * 0.95) - 1] ?? 0;
}

/** A ref for elements holding one line of text: each has the `truncated` class while its text overflows it, and is watched until it unmounts. */
function useTruncatedClass(): RefCallback<HTMLElement> {
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback((element: HTMLElement | null) => {
    if (element === null) return;
    observer.current ??= new ResizeObserver((entries) => {
      for (const { target } of entries) target.classList.toggle("truncated", target.scrollWidth > target.clientWidth);
    });
    observer.current.observe(element);
    return () => observer.current?.unobserve(element);
  }, []);
}

/** The cells of one component: its button, name and detail link, package, version, files, uses and, given, its change. */
function RowCells({ r, nameRef, shortPath, href, selected, tabStop, onButtonClick, mark, showChange, writtenAs }: { r: ComponentRow; nameRef: RefCallback<HTMLElement>; shortPath: string | undefined; href: string | undefined; selected: boolean; tabStop: boolean; onButtonClick: (e: MouseEvent<HTMLButtonElement>) => void; mark?: DiffMark | undefined; showChange: boolean; writtenAs?: string | undefined }) {
  const deprecated = r.deprecated;
  const delta = deltaOf(mark, r.occurrenceCount);
  const title = deprecated ? `${r.displayName} (deprecated)` : r.displayName;

  return (
    <>
      <TableCell className={NAME_CELL}>
        {/* The row's button takes no space; its ::after covers the row, under the name's link. */}
        <button
          type="button"
          data-row-name={r.componentId}
          tabIndex={tabStop ? 0 : -1}
          aria-current={selected ? "true" : undefined}
          onClick={onButtonClick}
          className="block size-0 focus-row after:absolute after:inset-0 after:content-['']"
        >
          <span className="sr-only">Details for {r.displayName}</span>
        </button>
        <div className={NAME_ROW}>
          {href === undefined ? (
            <span ref={nameRef} title={title} className="truncate-reveal font-mono font-medium"><span>{r.displayName}</span></span>
          ) : (
            <Link ref={nameRef} href={href} prefetch={false} tabIndex={tabStop ? 0 : -1} title={title} className="relative z-1 truncate-reveal font-mono font-medium underline-offset-3 hover:underline">
              <span>{r.displayName}</span>
            </Link>
          )}
          {deprecated ? <DeprecatedMark /> : null}
          {mark?.kind === "added" ? <Badge variant="outline" className={MARK_BADGE}>Added</Badge> : null}
        </div>
        {r.disambiguator ? (
          <div className="whitespace-normal wrap-anywhere text-code text-muted-foreground">
            {shortPath === undefined || shortPath === r.disambiguator ? (
              <SlashBreaks text={r.disambiguator} />
            ) : (
              <>
                <span aria-hidden className="select-none" title={r.disambiguator}><SlashBreaks text={shortPath} /></span>
                <span className="sr-only">{r.disambiguator}</span>
              </>
            )}
          </div>
        ) : null}
        {writtenAs ? (
          <div className="truncate text-xs text-muted-foreground" title={`Files write ${r.displayName} as ${writtenAs}`}>
            written as <span className="font-mono">{writtenAs}</span>
          </div>
        ) : null}
        {/* Stacked rows' summary tiers. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-normal text-xs text-muted-foreground @min-[43rem]:hidden">
          {r.packageName ? (
            <span className="min-w-0 max-w-full truncate font-mono" title={r.packageName}>{r.packageName}</span>
          ) : null}
          {r.packageName && r.version ? <Dot /> : null}
          {r.version ? (
            <span className="font-mono tabular-nums">{r.version}</span>
          ) : null}
        </div>
        {/* The change belongs to uses: `36 uses (−23)` or `5 uses (+5)`. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 whitespace-normal text-xs text-muted-foreground @min-[43rem]:hidden">
          <span>
            <span className="font-medium tabular-nums text-foreground">{r.occurrenceCount.toLocaleString()}</span>
            {r.occurrenceCount === 1 ? " use" : " uses"}
            {showChange && delta !== 0 ? <OccurrenceDelta delta={delta} deprecated={deprecated} /> : null}
          </span>
          <Dot />
          <span className="tabular-nums">
            {r.fileCount.toLocaleString()} {r.fileCount === 1 ? "file" : "files"}
          </span>
        </div>
      </TableCell>
      <TableCell
        className="hidden overflow-hidden truncate font-mono text-xs text-muted-foreground @min-[43rem]:table-cell"
        title={r.packageName ?? NO_PACKAGE_TITLE}
      >
        {r.packageName === null ? "—" : <PackageName name={r.packageName} />}
      </TableCell>
      <TableCell
        className="hidden overflow-hidden truncate font-mono text-xs tabular-nums text-muted-foreground @min-[43rem]:table-cell"
        title={r.version ?? undefined}
      >
        {r.version ?? "—"}
      </TableCell>
      <TableCell className="hidden text-end tabular-nums text-muted-foreground @min-[43rem]:table-cell">
        {r.fileCount.toLocaleString()}
      </TableCell>
      <TableCell className={cn("hidden text-end font-medium tabular-nums @min-[43rem]:table-cell", !showChange && "pe-3")}>
        {r.occurrenceCount.toLocaleString()}
      </TableCell>
      {showChange ? <ChangeCell mark={mark} occurrenceCount={r.occurrenceCount} deprecated={deprecated} /> : null}
    </>
  );
}

/**
 * A row removed since the previous scan. It stays visible because a finished
 * retirement looks like a row disappearing. Muted ink at full opacity (half
 * opacity failed contrast), no link or focus stop (there is no detail page),
 * version and files a dash, uses a muted zero, and its change the negated
 * previous count.
 */
function GhostRow({ r, index, measure, nameRef }: { r: ComponentRow; index: number; measure: (el: HTMLTableRowElement | null) => void; nameRef: RefCallback<HTMLElement> }) {
  return (
    <TableRow data-index={index} ref={measure}>
      <TableCell className={NAME_CELL}>
        <div className={NAME_ROW}>
          <span ref={nameRef} className="truncate-reveal font-mono font-medium text-muted-foreground" title={r.deprecated ? `${r.displayName} (deprecated)` : r.displayName}><span>{r.displayName}</span></span>
          {r.deprecated ? <DeprecatedMark /> : null}
          <Badge variant="outline" className={MARK_BADGE}>Removed</Badge>
        </div>
        {/* Stacked rows' tiers: the package, then `0 uses (−5)`. */}
        {r.packageName ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-normal text-xs text-muted-foreground @min-[43rem]:hidden">
            <span className="min-w-0 max-w-full truncate font-mono" title={r.packageName}>{r.packageName}</span>
          </div>
        ) : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 whitespace-normal text-xs text-muted-foreground @min-[43rem]:hidden">
          <span>
            <span className="tabular-nums">0</span>
            {" uses"}
            {/* A held reference with no occurrences lost none, so it shows no Δ. */}
            {r.occurrenceCount > 0 ? (
              <OccurrenceDelta delta={deltaOf({ kind: "removed" }, r.occurrenceCount)} deprecated={r.deprecated} />
            ) : null}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden overflow-hidden truncate font-mono text-xs text-muted-foreground @min-[43rem]:table-cell" title={r.packageName ?? NO_PACKAGE_TITLE}>
        {r.packageName === null ? "—" : <PackageName name={r.packageName} />}
      </TableCell>
      <TableCell className="hidden text-faint @min-[43rem]:table-cell">—</TableCell>
      <TableCell className="hidden text-end text-faint @min-[43rem]:table-cell">—</TableCell>
      <TableCell className="hidden text-end tabular-nums text-muted-foreground @min-[43rem]:table-cell">0</TableCell>
      <ChangeCell mark={{ kind: "removed" }} occurrenceCount={r.occurrenceCount} deprecated={r.deprecated} />
    </TableRow>
  );
}

/** The Change cell: a signed Δ coloured by `deltaTone`, or a faint dash for no change. */
function ChangeCell({ mark, occurrenceCount, deprecated }: { mark: DiffMark | undefined; occurrenceCount: number; deprecated: boolean }) {
  const delta = deltaOf(mark, occurrenceCount);
  return (
    <TableCell className="hidden pe-3 text-end tabular-nums @min-[43rem]:table-cell">
      {delta !== 0 ? (
        <span className={`font-medium ${deltaTone(delta, deprecated)}`}>{signedCount(delta)}</span>
      ) : (
        <span className="text-faint">—</span>
      )}
    </TableCell>
  );
}

/** The mobile tier's occurrence Δ, ` (−23)`, coloured by `deltaTone` like the
 *  desktop cell. */
function OccurrenceDelta({ delta, deprecated }: { delta: number; deprecated: boolean }) {
  return (
    <>
      {" ("}
      <span className={`font-medium tabular-nums ${deltaTone(delta, deprecated)}`}>{signedCount(delta)}</span>
      {")"}
    </>
  );
}

// Shortens a disambiguator path to its last two segments with a leading
// ellipsis. The full path stays in the cell's `title`.
export function shortenPath(path: string, segments = 2): string {
  const parts = path.split("/");
  if (parts.length <= segments) return path;
  return `…/${parts.slice(-segments).join("/")}`;
}

/**
 * Separator for flex-gap layouts. `text-border` measured 1.03:1 against the
 * panel in dark mode, and in stacked rows this dot is the only thing separating
 * package from version.
 */
function Dot() {
  return (
    <span aria-hidden className="text-faint">
      ·
    </span>
  );
}
