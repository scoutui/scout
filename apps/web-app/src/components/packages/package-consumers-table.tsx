"use client";
import { useMemo } from "react";
import type { PackageRepoVersionCell } from "@scoutui/web-shared";
import { plural } from "@scoutui/web-shared/client";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CellLink } from "@/components/ui/cell-link";
import { SlashBreaks } from "@/components/dashboards/cohort-label";
import { SortButton, sortRows, useSort } from "@/components/ui/sortable";
import { computeVersionShare, latestVersion } from "@/components/viz/version-composition";
import { packageFilterHref } from "@/lib/component-facets";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { relativeTime } from "@/lib/relative-time";

type SortKey = "repoId" | "version" | "occurrenceCount" | "committedAt";
const DESC_KEYS: ReadonlySet<SortKey> = new Set(["occurrenceCount", "committedAt"]);

/** Who consumes this package: one row per (repo, version) cell, the same shape
 *  at one consumer or fifty. The version dot ties each row to the masthead
 *  bar's latest/behind split. */
export function PackageConsumersTable({
  cells,
  packageName,
}: {
  cells: PackageRepoVersionCell[];
  packageName: string;
}) {
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("occurrenceCount", "desc", DESC_KEYS);
  const sorted = useMemo(
    () => sortRows(cells, sortKey, sortDir, (c, k) => c[k]),
    [cells, sortKey, sortDir],
  );
  // Same seam as the masthead bar, so the dot colour and the bar's "latest"
  // segment agree. Null when fully unversioned, so no dots.
  const latest = useMemo(() => {
    const distinct = new Set(cells.filter(c => c.version !== null).map(c => c.version)).size;
    return latestVersion(computeVersionShare(cells, distinct));
  }, [cells]);

  if (cells.length === 0) {
    return <p className="text-sm text-muted-foreground">No repos use this package yet.</p>;
  }

  return (
    <div className="panel overflow-hidden">
      <Table containerClassName="max-h-[70vh] overflow-y-auto">
        <TableHeader className="sticky top-0 z-10 hidden sm:table-header-group">
          <TableRow>
            <TableHead className="w-full">
              <SortButton label="Repo" sortKey="repoId" current={sortKey} dir={sortDir} onClick={toggleSort} />
            </TableHead>
            <TableHead className="whitespace-nowrap">
              <SortButton label="Version" sortKey="version" current={sortKey} dir={sortDir} onClick={toggleSort} />
            </TableHead>
            <TableHead className="whitespace-nowrap text-right">
              <SortButton label="Uses" sortKey="occurrenceCount" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
            </TableHead>
            <TableHead className="whitespace-nowrap text-right pr-3">
              <SortButton label="Committed" sortKey="committedAt" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(c => {
            const href = packageFilterHref(c.repoId, packageName);
            const dot = latest !== null ? (
              <span
                aria-hidden
                className={`size-1.5 shrink-0 rounded-full ${c.version === latest ? "bg-viz-primary" : "bg-viz-legacy"}`}
              />
            ) : null;
            return (
              <TableRow key={`${c.repoId}\0${c.version ?? ""}`} className="cursor-pointer hover:bg-muted/50">
                <CellLink href={href} cellClassName="w-full max-w-0" title={c.repoId}>
                  <span className="block text-code max-sm:whitespace-normal max-sm:wrap-anywhere sm:truncate"><SlashBreaks text={c.repoId} /></span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-normal text-xs tabular-nums text-muted-foreground sm:hidden">
                    <span className="inline-flex items-center gap-1.5 font-mono">{dot}{c.version ?? "unversioned"}</span>
                    <Dot />
                    <span>{plural(c.occurrenceCount, "use")}</span>
                    <Dot />
                    <span>{relativeTime(c.committedAt)}</span>
                  </span>
                </CellLink>
                <CellLink href={href} tabIndex={-1} cellClassName="hidden sm:table-cell" className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                  {dot}
                  {c.version ?? "—"}
                </CellLink>
                <CellLink href={href} tabIndex={-1} cellClassName="hidden sm:table-cell" className="text-right tabular-nums">
                  {c.occurrenceCount.toLocaleString()}
                </CellLink>
                <CellLink
                  href={href}
                  tabIndex={-1}
                  cellClassName="hidden pr-1 sm:table-cell"
                  className="text-right text-xs text-muted-foreground"
                  title={formatAbsoluteUtc(c.committedAt)}
                >
                  {relativeTime(c.committedAt)}
                </CellLink>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Dot() {
  return <span aria-hidden className="text-border">·</span>;
}
