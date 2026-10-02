"use client";
import { useMemo } from "react";
import Link from "next/link";
import type { PackageRepoVersionCell } from "@scoutui/web-shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortButton, sortRows, useSort } from "@/components/ui/sortable";
import { computeVersionShare, latestVersion } from "@/components/viz/version-composition";
import { packageFilterQuery } from "@/lib/component-facets";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { relativeTime } from "@/lib/relative-time";

type SortKey = "repoId" | "version" | "occurrenceCount" | "committedAt";
const DESC_KEYS: ReadonlySet<SortKey> = new Set(["occurrenceCount", "committedAt"]);

// Deep link into a repo's components table, pre-filtered to this package via
// the repo explorer's `?q=` grammar.
function repoFilterHref(repoId: string, packageName: string): string {
  return `/repos/${encodeURIComponent(repoId)}?q=${encodeURIComponent(packageFilterQuery(packageName))}`;
}

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
    return <p className="text-sm text-muted-foreground">No usage recorded.</p>;
  }

  return (
    <div className="panel overflow-hidden">
      <Table containerClassName="max-h-[70vh] overflow-y-auto">
        <TableHeader className="sticky top-0 z-10">
          <TableRow>
            <TableHead className="w-full">
              <SortButton label="Repo" sortKey="repoId" current={sortKey} dir={sortDir} onClick={toggleSort} />
            </TableHead>
            <TableHead className="whitespace-nowrap">
              <SortButton label="Version" sortKey="version" current={sortKey} dir={sortDir} onClick={toggleSort} />
            </TableHead>
            <TableHead className="whitespace-nowrap text-right">
              <SortButton label="Occurrences" sortKey="occurrenceCount" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
            </TableHead>
            <TableHead className="whitespace-nowrap text-right pr-3">
              <SortButton label="Updated" sortKey="committedAt" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(c => {
            const href = repoFilterHref(c.repoId, packageName);
            return (
              <TableRow key={`${c.repoId}\0${c.version ?? ""}`} className="cursor-pointer hover:bg-muted/50">
                <CellLink href={href} cellClassName="w-full max-w-0" className="truncate text-code" title={c.repoId}>
                  {c.repoId}
                </CellLink>
                <CellLink href={href} className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                  {latest !== null ? (
                    <span
                      aria-hidden
                      className={`size-1.5 shrink-0 rounded-full ${c.version === latest ? "bg-viz-primary" : "bg-viz-legacy"}`}
                    />
                  ) : null}
                  {c.version ?? "—"}
                </CellLink>
                <CellLink href={href} className="text-right tabular-nums">
                  {c.occurrenceCount.toLocaleString()}
                </CellLink>
                <CellLink
                  href={href}
                  cellClassName="pr-1"
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

// Whole-row navigation: every cell is the same link, so a click anywhere in
// the row drills into that repo pre-filtered to this package.
function CellLink({
  href,
  className,
  cellClassName,
  title,
  children,
}: {
  href: string;
  className?: string;
  cellClassName?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <TableCell className={`p-0 ${cellClassName ?? ""}`}>
      <Link href={href} title={title} className={`block px-3 py-2 ${className ?? ""}`}>
        {children}
      </Link>
    </TableCell>
  );
}
