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
                  <span className={p.distinctVersionCount === 1 && p.soleVersion ? "font-mono" : undefined}>{versionLabel(p)}</span>
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

/** Same semantics as VersionCell, as plain text for the stacked mobile tier. */
function versionLabel(pkg: PackageSummary): string {
  if (pkg.distinctVersionCount === 0) return "unversioned";
  if (pkg.distinctVersionCount === 1 && pkg.soleVersion) return pkg.soleVersion;
  return `${pkg.distinctVersionCount.toLocaleString()} versions`;
}

/** One version shows the version itself, several show the count, none shows a
 *  dash (an unversioned workspace package). */
function VersionCell({ pkg }: { pkg: PackageSummary }) {
  if (pkg.distinctVersionCount === 0) {
    return (
      <span className="text-muted-foreground" title="No version recorded">
        —
      </span>
    );
  }
  if (pkg.distinctVersionCount === 1 && pkg.soleVersion) {
    return <span className="font-mono text-xs tabular-nums">{pkg.soleVersion}</span>;
  }
  return (
    <span className="whitespace-nowrap text-xs font-medium tabular-nums">
      {pkg.distinctVersionCount.toLocaleString()} versions
    </span>
  );
}
