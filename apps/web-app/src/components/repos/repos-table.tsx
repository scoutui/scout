"use client";
import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { RepoSummary } from "@scoutui/web-shared";
import { repoDeltaMoved } from "@scoutui/web-shared/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortButton, ariaSort, sortRows, useSort } from "@/components/ui/sortable";
import { cn } from "@/lib/utils";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { relativeTime } from "@/lib/relative-time";
import { deltaTone, movementParts, signedCount } from "@/lib/scan-diff-view";

// Identity, scan provenance, size and deprecated use only. Everything else
// (remote, packages, occurrences, origin split) is on the repo's masthead.
type SortKey = "repoId" | "arrivedAt" | "committedAt" | "componentCount" | "deprecatedCount" | "delta";

// Columns that open descending (most-recent / highest-count first); repoId opens A→Z.
const DESC_KEYS: ReadonlySet<SortKey> = new Set([
  "arrivedAt",
  "committedAt",
  "componentCount",
  "deprecatedCount",
  "delta",
]);

/** Movement magnitude for the Changes sort; null (first scan) sorts last. */
function movement(r: RepoSummary): number | null {
  return r.delta === null ? null : r.delta.added + r.delta.removed + r.delta.changed + Math.abs(r.delta.deprecated);
}

export function ReposTable({ rows }: { rows: RepoSummary[] }) {
  // Default: most recently scanned first.
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("arrivedAt", "desc", DESC_KEYS);

  const visible = useMemo(
    () => sortRows(rows, sortKey, sortDir, (r, k) => (k === "delta" ? movement(r) : r[k])),
    [rows, sortKey, sortDir],
  );

  return (
    <Table containerClassName="max-h-[70vh] overflow-y-auto">
      {/* Below lg the rows stack, so there are no headers and no sorting. */}
      <TableHeader className="sticky top-0 z-10 hidden lg:table-header-group">
        <TableRow>
          <TableHead className="w-full min-w-48" aria-sort={ariaSort("repoId", sortKey, sortDir)}>
            <SortButton label="Repo" sortKey="repoId" current={sortKey} dir={sortDir} onClick={toggleSort} />
          </TableHead>
          <TableHead className="whitespace-nowrap" aria-sort={ariaSort("arrivedAt", sortKey, sortDir)}>
            <SortButton label="Last scan" sortKey="arrivedAt" current={sortKey} dir={sortDir} onClick={toggleSort} />
          </TableHead>
          <TableHead className="whitespace-nowrap" aria-sort={ariaSort("committedAt", sortKey, sortDir)}>
            <SortButton label="Committed" sortKey="committedAt" current={sortKey} dir={sortDir} onClick={toggleSort} />
          </TableHead>
          <TableHead className="whitespace-nowrap text-right" aria-sort={ariaSort("componentCount", sortKey, sortDir)}>
            <SortButton label="Components" sortKey="componentCount" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
          </TableHead>
          <TableHead className="whitespace-nowrap text-right" aria-sort={ariaSort("deprecatedCount", sortKey, sortDir)}>
            <SortButton label="Deprecated" sortKey="deprecatedCount" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
          </TableHead>
          <TableHead className="whitespace-nowrap text-right" aria-sort={ariaSort("delta", sortKey, sortDir)}>
            <SortButton
              label="Changes"
              title="Changes: added, removed or changed since the previous scan"
              sortKey="delta"
              current={sortKey}
              dir={sortDir}
              onClick={toggleSort}
              align="right"
            />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {visible.map((r) => (
          <RepoRow key={r.repoId} row={r} />
        ))}
      </TableBody>
    </Table>
  );
}

function RepoRow({ row: r }: { row: RepoSummary }) {
  const href = `/repos/${encodeURIComponent(r.repoId)}`;

  return (
    // The repo-id link's ::after fills the positioned <tr>, so the whole row is
    // the pointer target and keyboard users get one stop per row.
    <TableRow className="relative cursor-pointer">
      <TableCell className="w-full min-w-48 max-w-0 align-top">
        <div className="flex flex-col gap-0.5">
          <Link
            href={href}
            title={[r.repoId, provenance(r)].filter(Boolean).join("\n")}
            className="block max-w-full font-mono text-sm font-medium text-foreground focus-row after:absolute after:inset-0 after:content-['']"
          >
            <span className="block truncate">{r.repoId}</span>
          </Link>
          <ScanMeta row={r} className="hidden lg:flex" />
          {/* Stacked tiers below lg. */}
          <div className="flex flex-col gap-1 whitespace-normal pt-1 lg:hidden">
            <ScanMeta row={r} lead />
            <span className="text-xs tabular-nums text-muted-foreground">
              {r.componentCount.toLocaleString()} components
            </span>
            {r.deprecatedCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-status-warn-text">
                <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
                <span className="tabular-nums">{r.deprecatedCount.toLocaleString()}</span>
                deprecated in use
              </span>
            ) : null}
            {r.delta !== null && repoDeltaMoved(r.delta) ? <MobileMovement delta={r.delta} /> : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden align-top lg:table-cell">
        <span title={formatAbsoluteUtc(r.arrivedAt)}>{relativeTime(r.arrivedAt)}</span>
      </TableCell>
      <TableCell className="hidden align-top text-muted-foreground lg:table-cell">
        <span title={formatAbsoluteUtc(r.committedAt)}>{relativeTime(r.committedAt)}</span>
      </TableCell>
      <TableCell className="hidden align-top text-right tabular-nums lg:table-cell">
        {r.componentCount.toLocaleString()}
      </TableCell>
      <TableCell
        className={`hidden align-top text-right tabular-nums lg:table-cell ${
          r.deprecatedCount > 0 ? "font-medium text-status-warn-text" : r.delta !== null && r.delta.deprecated !== 0 ? "text-muted-foreground" : "text-faint"
        }`}
      >
        {/* Zero shows as a faint dash, unless it moved: a finished retirement
            reads `0 (−2)`. */}
        {r.deprecatedCount > 0 || (r.delta !== null && r.delta.deprecated !== 0) ? r.deprecatedCount.toLocaleString() : "—"}
        {/* The signed movement sits beside the count at the same size,
            `14 (−2)`. Only the number takes `deltaTone`'s retirement polarity
            (more is red, fewer is plain ink); the brackets stay muted. */}
        {r.delta !== null && r.delta.deprecated !== 0 ? (
          <span className="font-normal text-muted-foreground">
            {" ("}
            <span className={`font-medium ${deltaTone(r.delta.deprecated, true)}`}>{signedCount(r.delta.deprecated)}</span>
            {")"}
          </span>
        ) : null}
      </TableCell>
      <SinceLastScanCell delta={r.delta} />
    </TableRow>
  );
}

/** `+3`, `−16` or `18`: a movement part's number, signed unless it counts changed components. */
function partCount(p: ReturnType<typeof movementParts>[number]): string {
  return p.word === "changed" ? p.n.toLocaleString() : signedCount(p.word === "added" ? p.n : -p.n);
}

/** The mobile tier's movement line, `+3 added · −16 removed · 18 changed ·
 *  deprecated (−2) since previous scan`, with zero parts omitted. Only the
 *  deprecated Δ takes `deltaTone`, as in the desktop cell. */
function MobileMovement({ delta }: { delta: NonNullable<RepoSummary["delta"]> }) {
  const lead = movementParts(delta)
    .map((p) => `${partCount(p)} ${p.word}`)
    .join(" · ");
  return (
    <span className="text-xs font-medium tabular-nums text-foreground">
      {lead}
      {delta.deprecated !== 0 ? (
        <>
          {lead ? " · " : null}
          {"deprecated ("}
          <span className={deltaTone(delta.deprecated, true)}>{signedCount(delta.deprecated)}</span>
          {")"}
        </>
      ) : null}
      {" since previous scan"}
    </span>
  );
}

/** The Changes cell, in words: `+3 added · −16 removed · 13 changed`, so signs
 *  never read as a net sum. Zero parts are omitted; a faint dash when no
 *  component moved, and `first scan` when there is no earlier scan. */
function SinceLastScanCell({ delta }: { delta: RepoSummary["delta"] }) {
  const cell = "hidden align-top text-right tabular-nums lg:table-cell";
  if (delta === null) {
    return (
      <TableCell className={cell}>
        <span className="text-xs text-muted-foreground">first scan</span>
      </TableCell>
    );
  }
  const parts = movementParts(delta);
  if (parts.length === 0) {
    return <TableCell className={`${cell} text-faint`}>—</TableCell>;
  }
  return (
    <TableCell className={`${cell} text-muted-foreground`}>
      {parts.map((p, i) => (
        <span key={p.word}>
          {i > 0 ? " · " : null}
          <span className="font-medium text-foreground">{partCount(p)}</span>
          {` ${p.word}`}
        </span>
      ))}
    </TableCell>
  );
}

/** `branch · short sha`, whichever the scan recorded. */
function provenance(r: RepoSummary): string {
  return [r.branch, r.commit.slice(0, 7)].filter(Boolean).join(" · ");
}

/** The line under a repo's name: branch · short sha, on one line where a branch
 *  past its cap truncates and the sha never does. With
 *  `lead`, the scan time opens it (the mobile tier has no Last scan column). */
function ScanMeta({ row: r, lead, className }: { row: RepoSummary; lead?: boolean; className?: string }) {
  const shortCommit = r.commit.slice(0, 7);
  const parts = [
    lead ? (
      <span key="scanned" className="shrink-0 text-foreground">
        Scanned {relativeTime(r.arrivedAt)}
      </span>
    ) : null,
    r.branch ? (
      <span key="branch" className="min-w-0 max-w-[24ch] truncate font-mono">
        {r.branch}
      </span>
    ) : null,
    shortCommit ? (
      <span key="commit" className="shrink-0 font-mono">
        {shortCommit}
      </span>
    ) : null,
  ].filter((part) => part !== null);
  if (parts.length === 0) return null;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground", className)}>
      {parts.map((part, i) => (i === 0 ? part : [<Dot key={`dot-${part.key}`} />, part]))}
    </span>
  );
}

function Dot() {
  return (
    <span aria-hidden className="shrink-0 text-border">
      ·
    </span>
  );
}
