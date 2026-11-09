"use client";
import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import type { PackageSummary } from "@scoutui/web-shared";
import { plural } from "@scoutui/web-shared/client";
import {
  Table, TableBody, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CellLink } from "@/components/ui/cell-link";
import { deprecatedComponentsHref } from "@/lib/package-facets";
import { SortButton, sortRows, useSort } from "@/components/ui/sortable";
import { TagChips } from "@/components/tags/tag-chip";
import { versionRangeLabel } from "@/lib/version-order";

type SortKey = "packageName" | "consumerCount" | "componentCount" | "distinctVersionCount" | "totalOccurrences" | "deprecatedCount";

const NUMERIC_KEYS: ReadonlySet<SortKey> = new Set([
  "consumerCount", "componentCount", "distinctVersionCount", "totalOccurrences", "deprecatedCount",
]);

/**
 * `deprecatedOnly` carries the list's deprecated filter into the package the
 * user clicks. Here it means "this package has deprecated components", there
 * "this component is deprecated", so the Deprecated count clicked matches the
 * rows shown. A `tag:` filter isn't carried: choosing a package already
 * satisfies it. Most facets don't survive the change of grain like this one.
 */
export function PackagesTable({
  rows,
  deprecatedOnly = false,
}: {
  rows: PackageSummary[];
  deprecatedOnly?: boolean;
}) {
  // Default sort matches the projection's own default (occurrences desc).
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("totalOccurrences", "desc", NUMERIC_KEYS);

  const visible = useMemo(
    () => sortRows(rows, sortKey, sortDir, (r, k) => r[k]),
    [rows, sortKey, sortDir],
  );

  return (
    <Table containerClassName="max-h-[70vh] overflow-y-auto">
      {/* Below sm the rows stack, so there are no headers and no sorting. */}
      <TableHeader className="sticky top-0 z-10 hidden sm:table-header-group">
        <TableRow>
          <TableHead className="w-full">
            <SortButton label="Package" sortKey="packageName" current={sortKey} dir={sortDir} onClick={toggleSort} />
          </TableHead>
          <TableHead className="whitespace-nowrap text-right">
            <SortButton label="Repos" sortKey="consumerCount" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
          </TableHead>
          <TableHead className="whitespace-nowrap text-right">
            <SortButton label="Components" sortKey="componentCount" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
          </TableHead>
          <TableHead className="whitespace-nowrap text-right">
            <SortButton label="Version" sortKey="distinctVersionCount" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
          </TableHead>
          <TableHead className="whitespace-nowrap text-right">
            <SortButton label="Uses" sortKey="totalOccurrences" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
          </TableHead>
          <TableHead className="whitespace-nowrap text-right">
            <SortButton label="Deprecated" sortKey="deprecatedCount" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {visible.map(p => {
          const href = deprecatedOnly ? deprecatedComponentsHref(p.packageName) : `/packages/${encodeURIComponent(p.packageName)}`;
          return (
            <TableRow key={p.packageName} className="cursor-pointer hover:bg-muted/50">
              <CellLink href={href} cellClassName="w-full max-w-0" title={p.packageName}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-sm">{p.packageName}</span>
                  {p.tags?.length ? <TagChips tags={p.tags} /> : null}
                </span>
                {/* Stacked summary tier below sm. */}
                <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-normal text-xs tabular-nums text-muted-foreground sm:hidden">
                  <span>{p.consumerCount.toLocaleString()} {p.consumerCount === 1 ? "repo" : "repos"}</span>
                  <span aria-hidden className="text-border">·</span>
                  <span>{p.componentCount.toLocaleString()} {p.componentCount === 1 ? "component" : "components"}</span>
                  <span aria-hidden className="text-border">·</span>
                  <span className="font-mono">{versionRangeLabel(p.versionRange) ?? "unversioned"}</span>
                  <span aria-hidden className="text-border">·</span>
                  <span>{plural(p.totalOccurrences, "use")}</span>
                </span>
                {p.deprecatedCount > 0 ? (
                  <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-status-warn-text sm:hidden">
                    <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
                    <span className="tabular-nums">{p.deprecatedCount.toLocaleString()}</span>
                    deprecated in use
                  </span>
                ) : null}
              </CellLink>
              <CellLink href={href} tabIndex={-1} cellClassName="hidden sm:table-cell" className="text-right tabular-nums">
                {p.consumerCount.toLocaleString()}
              </CellLink>
              <CellLink href={href} tabIndex={-1} cellClassName="hidden sm:table-cell" className="text-right tabular-nums">
                {p.componentCount.toLocaleString()}
              </CellLink>
              <CellLink href={href} tabIndex={-1} cellClassName="hidden sm:table-cell" className="text-right">
                <VersionCell pkg={p} />
              </CellLink>
              <CellLink href={href} tabIndex={-1} cellClassName="hidden sm:table-cell" className="text-right tabular-nums">
                {p.totalOccurrences.toLocaleString()}
              </CellLink>
              <CellLink href={href} tabIndex={-1} cellClassName="hidden sm:table-cell" className={`text-right tabular-nums ${p.deprecatedCount > 0 ? "font-medium text-status-warn-text" : "text-muted-foreground"}`}>
                {p.deprecatedCount.toLocaleString()}
              </CellLink>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** The oldest to the newest version in use, or a dash when none is recorded. */
function VersionCell({ pkg }: { pkg: PackageSummary }) {
  const label = versionRangeLabel(pkg.versionRange);
  if (label === null) {
    return (
      <span className="text-muted-foreground" title="No version recorded">
        —
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap font-mono text-xs tabular-nums" title={plural(pkg.distinctVersionCount, "version")}>
      {label}
    </span>
  );
}
