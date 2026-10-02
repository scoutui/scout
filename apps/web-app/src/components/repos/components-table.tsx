"use client";
import { useMemo, useRef } from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ComponentRow, DiffMark } from "@scoutui/web-shared";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DeprecatedMark } from "@/components/deprecated-mark";
import { SortButton, ariaSort, sortRows, useSort, type SortDir } from "@/components/ui/sortable";
import { writtenNameMatch } from "@/lib/component-facets";
import { deltaOf, deltaTone, signedCount } from "@/lib/scan-diff-view";
import { compareVersions } from "@/lib/version-order";

const COLUMN_COUNT = 5;

const NO_PACKAGE_TITLE = "no import links this usage to a package";

/** The outline badge for `added` and `removed` rows. Its border clears the 3:1
 *  non-text minimum on the panel (3.3:1 light, 3.8:1 dark); the default
 *  `--hairline` outline measured 1.21:1 on dark, and `/35` 1.4:1 on light. */
const MARK_BADGE = "shrink-0 border-muted-foreground/70 text-muted-foreground";

/** A row's name line: wraps below sm (a badge beside a long name pushed the
 *  390px table 44px past its scroller), one truncating line from sm up. */
const NAME_ROW = "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 sm:flex-nowrap";

type SortKey = "displayName" | "packageName" | "version" | "fileCount" | "occurrenceCount" | "delta";
// `delta` is not here: the changed view's Occurrences header opens ascending
// (biggest drop first) every time, including on coming back to it from
// another column.
const DESC_KEYS: ReadonlySet<SortKey> = new Set(["fileCount", "occurrenceCount"]);

/** One row per component, keyed and linked by its component id. */
export function ComponentsTable({
  repoId,
  rows,
  marks,
  notInLatest,
  search,
}: {
  repoId: string;
  rows: ComponentRow[];
  /** componentId → scan-diff mark. Defined only in the changed view: it puts each
   *  row's signed Δ beside its occurrence count (`49 (+2)`), renders `removed`
   *  marks as ghosts, and points the Occurrences header at the Δ, opening
   *  ascending. */
  marks?: Record<string, DiffMark> | undefined;
  /** Components the latest scan doesn't have. They have no detail page, so their rows have no link. */
  notInLatest?: ReadonlySet<string> | undefined;
  /** The search box text: a row it finds only by a written name says which. */
  search?: string;
}) {
  // Default: most-used first. The changed view's Occurrences header sorts by
  // the signed Δ instead, biggest drop first.
  const occurrencesKey: SortKey = marks ? "delta" : "occurrenceCount";
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>(
    occurrencesKey,
    marks ? "asc" : "desc",
    DESC_KEYS,
  );

  const sorted = useMemo(
    () =>
      sortKey === "version"
        ? sortByVersion(rows, sortDir)
        : sortRows(rows, sortKey, sortDir, (r, k) =>
            k === "delta" ? deltaOf(marks?.[r.componentId], r.occurrenceCount) : r[k],
          ),
    [rows, sortKey, sortDir, marks],
  );
  // One Δ slot width for the whole table, from its widest Δ, so the slots
  // share a left edge but a short Δ doesn't reserve room for a long one: at
  // 1024 the Occurrences column has 80px of content.
  const slotCh = useMemo(
    () =>
      marks
        ? rows.reduce((w, r) => {
            const d = deltaOf(marks[r.componentId], r.occurrenceCount);
            return d === 0 ? w : Math.max(w, slotWidthCh(d));
          }, 0)
        : 0,
    [rows, marks],
  );

  // Only the visible window renders: at ~1,900 rows the full render dominates
  // first load. initialRect lets the server render a first window, so the table
  // doesn't flash empty. estimateSize is the measured desktop row height;
  // measureElement corrects the taller stacked rows below `sm`.
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

  // table-fixed only where the column grid exists (sm+); on mobile the single
  // visible stacked cell must take the full width under auto layout.
  return (
    <Table containerRef={scrollRef} containerClassName="max-h-[70vh] overflow-y-auto" className="sm:table-fixed">
      {/* Below sm the rows stack, so there are no headers and no sorting. */}
      <TableHeader className="sticky top-0 z-10 hidden sm:table-header-group">
        <TableRow>
          <TableHead className="w-[40%]" aria-sort={ariaSort("displayName", sortKey, sortDir)}>
            <SortButton label="Component" sortKey="displayName" current={sortKey} dir={sortDir} onClick={toggleSort} />
          </TableHead>
          {/* Below xl, Occurrences takes 5 points from Package: at 11% the
              changed view's `475 (−9)` overflowed at 640 and the header
              truncated at 1024. Both views share the widths, so toggling
              reflows nothing. */}
          <TableHead className="w-[23%] xl:w-[28%]" aria-sort={ariaSort("packageName", sortKey, sortDir)}>
            <SortButton label="Package" sortKey="packageName" current={sortKey} dir={sortDir} onClick={toggleSort} />
          </TableHead>
          <TableHead className="w-[11%]" aria-sort={ariaSort("version", sortKey, sortDir)}>
            <SortButton label="Version" sortKey="version" current={sortKey} dir={sortDir} onClick={toggleSort} />
          </TableHead>
          <TableHead className="w-[9%] text-right" aria-sort={ariaSort("fileCount", sortKey, sortDir)}>
            <SortButton label="Files" sortKey="fileCount" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
          </TableHead>
          <TableHead className="w-[17%] text-right pr-3 xl:w-[12%]" aria-sort={ariaSort(occurrencesKey, sortKey, sortDir)}>
            {/* The visible label stays `Occurrences`; in the changed view the
                title and accessible name say the sort key is the Δ, so
                "ascending" is never announced over counts that aren't. */}
            <SortButton
              label="Occurrences"
              title={marks ? "Occurrences, sorts by change since previous scan" : undefined}
              sortKey={occurrencesKey}
              current={sortKey}
              dir={sortDir}
              onClick={toggleSort}
              align="right"
            />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {paddingTop > 0 ? (
          <tr key="pad-top" aria-hidden>
            <td colSpan={COLUMN_COUNT} style={{ height: paddingTop }} />
          </tr>
        ) : null}
        {virtualRows.map(vr => {
          const row = sorted[vr.index];
          if (!row) return null;
          const mark = marks?.[row.componentId];
          if (mark?.kind === "removed") {
            return <GhostRow key={row.componentId} r={row} index={vr.index} measure={virtualizer.measureElement} slotCh={slotCh} />;
          }
          const linked = !notInLatest?.has(row.componentId);
          return (
            <TableRow
              key={row.componentId}
              data-index={vr.index}
              ref={virtualizer.measureElement}
              className={linked ? "relative cursor-pointer hover:bg-muted/50" : undefined}
            >
              <RowCells
                r={row}
                href={linked ? hrefFor(repoId, row.componentId) : undefined}
                mark={mark}
                delta={marks ? deltaOf(mark, row.occurrenceCount) : undefined}
                slotCh={slotCh}
                writtenAs={search ? writtenNameMatch(row, search) : undefined}
              />
            </TableRow>
          );
        })}
        {paddingBottom > 0 ? (
          <tr key="pad-bottom" aria-hidden>
            <td colSpan={COLUMN_COUNT} style={{ height: paddingBottom }} />
          </tr>
        ) : null}
      </TableBody>
    </Table>
  );
}

/** Sorts versions semver-aware: `sortRows` compares strings lexically, which
 *  puts `1.14.11` before `1.5.0`. Nulls last in both directions, as in
 *  `sortRows`. */
function sortByVersion(rows: readonly ComponentRow[], dir: SortDir): ComponentRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a.version;
    const bv = b.version;
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return compareVersions(av, bv) * sign;
  });
}

function hrefFor(repoId: string, componentId: string): string {
  return `/repos/${encodeURIComponent(repoId)}/components/${encodeURIComponent(componentId)}`;
}

/** The cells of one component: name and detail link, package, version, files and occurrences. */
function RowCells({ r, href, mark, delta, slotCh, writtenAs }: { r: ComponentRow; href: string | undefined; mark?: DiffMark | undefined; delta?: number | undefined; slotCh: number; writtenAs?: string | undefined }) {
  const deprecated = r.deprecated;

  return (
    <>
      <TableCell className="overflow-hidden align-middle">
        <div className={NAME_ROW}>
          {/* The row's one link: its ::after fills the positioned <tr>, so the
              whole row is the pointer target and keyboard users get one stop
              per row. */}
          {href === undefined ? (
            <span className="truncate font-mono font-medium" title={deprecated ? `${r.displayName} (deprecated)` : r.displayName}>
              {r.displayName}
            </span>
          ) : (
            <Link
              href={href}
              prefetch={false}
              title={deprecated ? `${r.displayName} (deprecated)` : r.displayName}
              className="truncate font-mono font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/50"
            >
              {r.displayName}
            </Link>
          )}
          {deprecated ? <DeprecatedMark /> : null}
          {/* An added row with no occurrences says so beside the badge instead
              of showing ±0 (below sm the occurrences tier already reads
              `0 occurrences`). Changed rows carry no badge: the Δ beside their
              count marks them. */}
          {mark?.kind === "added" ? (
            <>
              <Badge variant="outline" className={MARK_BADGE}>added</Badge>
              {r.occurrenceCount === 0 ? (
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">0 occurrences</span>
              ) : null}
            </>
          ) : null}
          {href === undefined ? <span className="shrink-0 text-xs text-muted-foreground">not in the latest scan</span> : null}
        </div>
        {r.disambiguator ? (
          <div className="truncate text-code text-muted-foreground" title={r.disambiguator}>
            {shortenPath(r.disambiguator)}
          </div>
        ) : null}
        {writtenAs ? (
          <div className="truncate text-xs text-muted-foreground" title={`Files write ${r.displayName} as ${writtenAs}`}>
            written as <span className="font-mono">{writtenAs}</span>
          </div>
        ) : null}
        {/* Stacked summary tiers below sm. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-normal text-xs text-muted-foreground sm:hidden">
          {r.packageName ? (
            <span className="font-mono">{r.packageName}</span>
          ) : null}
          {r.packageName && r.version ? <Dot /> : null}
          {r.version ? (
            <span className="font-mono tabular-nums">{r.version}</span>
          ) : null}
        </div>
        {/* The Δ is an occurrence Δ, so it attaches to occurrences:
            `36 occurrences (−23) · 30 files`. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 whitespace-normal text-xs text-muted-foreground sm:hidden">
          <span>
            <span className="font-medium tabular-nums text-foreground">{r.occurrenceCount.toLocaleString()}</span>
            {r.occurrenceCount === 1 ? " occurrence" : " occurrences"}
            {delta !== undefined && delta !== 0 ? <OccurrenceDelta delta={delta} deprecated={deprecated} /> : null}
          </span>
          <Dot />
          <span className="tabular-nums">
            {r.fileCount.toLocaleString()} {r.fileCount === 1 ? "file" : "files"}
          </span>
        </div>
      </TableCell>
      <TableCell
        className="hidden overflow-hidden truncate font-mono text-xs text-muted-foreground sm:table-cell"
        title={r.packageName ?? NO_PACKAGE_TITLE}
      >
        {r.packageName ?? "—"}
      </TableCell>
      <TableCell
        className="hidden overflow-hidden truncate font-mono text-xs tabular-nums text-muted-foreground sm:table-cell"
        title={r.version ?? undefined}
      >
        {r.version ?? "—"}
      </TableCell>
      <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">
        {r.fileCount.toLocaleString()}
      </TableCell>
      {delta !== undefined ? (
        // Changed view: the count is muted so the signed Δ stands out.
        <TableCell className="hidden pr-3 text-right tabular-nums text-muted-foreground sm:table-cell">
          {r.occurrenceCount.toLocaleString()}
          {" "}
          <DeltaSlot delta={delta} deprecated={deprecated} slotCh={slotCh} />
        </TableCell>
      ) : (
        <TableCell className="hidden pr-3 text-right font-medium tabular-nums sm:table-cell">
          {r.occurrenceCount.toLocaleString()}
        </TableCell>
      )}
    </>
  );
}

/**
 * A row removed since the previous scan. It stays visible because a finished
 * retirement looks like a row disappearing. Muted ink at full opacity (half
 * opacity failed contrast), no link or focus stop (there is no detail page),
 * version and files a dash, and occurrences `0 (−5)`: a faint zero beside the
 * negated previous count.
 */
function GhostRow({ r, index, measure, slotCh }: { r: ComponentRow; index: number; measure: (el: HTMLTableRowElement | null) => void; slotCh: number }) {
  return (
    <TableRow data-index={index} ref={measure}>
      <TableCell className="overflow-hidden align-middle">
        <div className={NAME_ROW}>
          <span className="truncate font-mono font-medium text-muted-foreground" title={r.deprecated ? `${r.displayName} (deprecated)` : r.displayName}>{r.displayName}</span>
          {r.deprecated ? <DeprecatedMark /> : null}
          <Badge variant="outline" className={MARK_BADGE}>removed</Badge>
        </div>
        {/* Stacked tiers below sm: the package, then `0 occurrences (−5)`. */}
        {r.packageName ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-normal text-xs text-muted-foreground sm:hidden">
            <span className="font-mono">{r.packageName}</span>
          </div>
        ) : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 whitespace-normal text-xs text-muted-foreground sm:hidden">
          <span>
            <span className="tabular-nums text-faint">0</span>
            {" occurrences"}
            {/* A held reference with no occurrences lost none, so it shows no Δ. */}
            {r.occurrenceCount > 0 ? (
              <OccurrenceDelta delta={deltaOf({ kind: "removed" }, r.occurrenceCount)} deprecated={r.deprecated} />
            ) : null}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden overflow-hidden truncate font-mono text-xs text-muted-foreground sm:table-cell" title={r.packageName ?? NO_PACKAGE_TITLE}>
        {r.packageName ?? "—"}
      </TableCell>
      <TableCell className="hidden text-faint sm:table-cell">—</TableCell>
      <TableCell className="hidden text-right text-faint sm:table-cell">—</TableCell>
      <TableCell className="hidden pr-3 text-right tabular-nums text-muted-foreground sm:table-cell">
        <span className="text-faint">0</span>
        {" "}
        <DeltaSlot delta={deltaOf({ kind: "removed" }, r.occurrenceCount)} deprecated={r.deprecated} slotCh={slotCh} />
      </TableCell>
    </TableRow>
  );
}

/**
 * The changed view's Δ beside an occurrence count, `(+2)`, coloured by
 * `deltaTone`. The slot is `slotCh` wide and left-aligned, so down the column
 * the counts share a right edge and the brackets a left edge. A zero Δ leaves
 * the slot empty but keeps its width.
 */
function DeltaSlot({ delta, deprecated, slotCh }: { delta: number; deprecated: boolean; slotCh: number }) {
  return (
    <span className="inline-block text-left" style={{ width: `${slotCh}ch` }}>
      {delta !== 0 ? (
        <>
          {"("}
          <span className={`font-medium ${deltaTone(delta, deprecated)}`}>{signedCount(delta)}</span>
          {")"}
        </>
      ) : null}
    </span>
  );
}

/** How wide `(−1,234)` sets in the cell's tabular sans, in ch: digits and signs
 *  are about 1ch, brackets and thousands commas about half (measured 8.4px vs
 *  ~4.3px at 14px, 1ch = 8.6px), plus half a ch of slack for the medium weight. */
function slotWidthCh(delta: number): number {
  const label = `(${signedCount(delta)})`;
  const narrow = label.replace(/[^(),]/g, "").length;
  return label.length - narrow / 2 + 0.5;
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
function shortenPath(path: string, segments = 2): string {
  const parts = path.split("/");
  if (parts.length <= segments) return path;
  return `…/${parts.slice(-segments).join("/")}`;
}

/**
 * Separator for flex-gap layouts. `text-border` measured 1.03:1 against the
 * panel in dark mode, and below `sm` this dot is the only thing separating
 * package from version.
 */
function Dot() {
  return (
    <span aria-hidden className="text-muted-foreground/70">
      ·
    </span>
  );
}
