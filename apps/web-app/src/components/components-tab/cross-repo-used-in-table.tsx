"use client";
import { useMemo } from "react";
import type { CrossRepoUsage } from "@scoutui/web-shared";
import { plural } from "@scoutui/web-shared/client";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CellLink } from "@/components/ui/cell-link";
import { SortButton, sortRows, useSort } from "@/components/ui/sortable";
import { computeVersionShare, latestVersion } from "@/components/viz/version-composition";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { relativeTime } from "@/lib/relative-time";

type SortKey = "repoId" | "version" | "occurrenceCount" | "deprecated" | "committedAt";
const DESC_KEYS: ReadonlySet<SortKey> = new Set(["occurrenceCount", "committedAt"]);

export function CrossRepoUsedInTable({
  componentId,
  usages,
}: {
  componentId: string;
  usages: CrossRepoUsage[];
}) {
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("occurrenceCount", "desc", DESC_KEYS);
  const sorted = useMemo(
    () => sortRows(usages, sortKey, sortDir, (u, k) => (k === "deprecated" ? (u.deprecated ? 1 : 0) : u[k])),
    [usages, sortKey, sortDir],
  );
  // Uses the masthead bar's version logic, so the dot colour and the bar's
  // "latest" segment agree. Null when the component is fully unversioned, and
  // then no dots render.
  const latest = useMemo(() => {
    const distinct = new Set(usages.filter(u => u.version !== null).map(u => u.version)).size;
    return latestVersion(computeVersionShare(usages, distinct));
  }, [usages]);

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
            <TableHead className="whitespace-nowrap text-right">
              <SortButton label="Deprecated" sortKey="deprecated" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
            </TableHead>
            <TableHead className="whitespace-nowrap text-right pr-3">
              <SortButton label="Committed" sortKey="committedAt" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(u => {
            const href = `/repos/${encodeURIComponent(u.repoId)}/components/${encodeURIComponent(componentId)}`;
            const dot = latest !== null ? (
              <span
                aria-hidden
                className={`size-1.5 shrink-0 rounded-full ${u.version === latest ? "bg-viz-primary" : "bg-viz-legacy"}`}
              />
            ) : null;
            return (
              <TableRow key={u.repoId} className="cursor-pointer hover:bg-muted/50">
                <CellLink href={href} cellClassName="w-full max-w-0" title={u.repoId}>
                  <span className="block truncate text-code">{u.repoId}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-normal text-xs tabular-nums text-muted-foreground sm:hidden">
                    <span className="inline-flex items-center gap-1.5 font-mono">{dot}{u.version ?? "unversioned"}</span>
                    <Dot />
                    <span>{plural(u.occurrenceCount, "use")}</span>
                    {u.deprecated ? (<><Dot /><span className="font-medium text-status-warn-text">deprecated</span></>) : null}
                    <Dot />
                    <span>{relativeTime(u.committedAt)}</span>
                  </span>
                </CellLink>
                <CellLink href={href} tabIndex={-1} cellClassName="hidden sm:table-cell" className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                  {dot}
                  {u.version ?? "—"}
                </CellLink>
                <CellLink href={href} tabIndex={-1} cellClassName="hidden sm:table-cell" className="text-right tabular-nums">
                  {u.occurrenceCount.toLocaleString()}
                </CellLink>
                <CellLink
                  href={href}
                  tabIndex={-1}
                  cellClassName="hidden sm:table-cell"
                  className={`text-right text-xs ${u.deprecated ? "font-medium text-status-warn-text" : "text-muted-foreground"}`}
                >
                  {u.deprecated ? "deprecated" : "—"}
                </CellLink>
                <CellLink
                  href={href}
                  tabIndex={-1}
                  cellClassName="hidden pr-1 sm:table-cell"
                  className="text-right text-xs text-muted-foreground"
                  title={formatAbsoluteUtc(u.committedAt)}
                >
                  {relativeTime(u.committedAt)}
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
