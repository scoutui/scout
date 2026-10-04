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
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { relativeTime } from "@/lib/relative-time";
import { deltaTone, movementParts, signedCount, sinceLastScan } from "@/lib/scan-diff-view";

// Identity, scan provenance, size and deprecated use only. Everything else
// (remote, packages, occurrences, origin split) is on the repo's masthead.
type SortKey = "repoId" | "committedAt" | "componentCount" | "deprecatedCount" | "delta";

// Columns that open descending (most-recent / highest-count first); repoId opens A→Z.
const DESC_KEYS: ReadonlySet<SortKey> = new Set([
  "committedAt",
  "componentCount",
  "deprecatedCount",
  "delta",
]);

/** Movement magnitude for the Δ components sort; null (first scan) sorts last. */
function movement(r: RepoSummary): number | null {
  return r.delta === null ? null : r.delta.added + r.delta.removed + r.delta.changed + Math.abs(r.delta.deprecated);
}

export function ReposTable({ rows }: { rows: RepoSummary[] }) {
  // Default: most recently scanned first.
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("committedAt", "desc", DESC_KEYS);

  const visible = useMemo(
    () => sortRows(rows, sortKey, sortDir, (r, k) => (k === "delta" ? movement(r) : r[k])),
    [rows, sortKey, sortDir],
  );

  return (
    <Table containerClassName="max-h-[70vh] overflow-y-auto">
      {/* Below sm the rows stack, so there are no headers and no sorting. */}
      <TableHeader className="sticky top-0 z-10 hidden sm:table-header-group">
        <TableRow>
          <TableHead className="w-full" aria-sort={ariaSort("repoId", sortKey, sortDir)}>
            <SortButton label="Repo" sortKey="repoId" current={sortKey} dir={sortDir} onClick={toggleSort} />
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
          {/* The title spells out what the Δ counts, which the cells' compact
              form below lg doesn't. */}
          <TableHead className="whitespace-nowrap text-right" aria-sort={ariaSort("delta", sortKey, sortDir)}>
            <SortButton
              label="Δ components"
              title="Δ components: added, removed or changed since previous scan"
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
      <TableCell className="w-full max-w-0 align-top">
        <div className="flex flex-col gap-0.5">
          <Link
            href={href}
            title={r.repoId}
            className="block max-w-full font-mono text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/50"
          >
            <span className="block truncate">{r.repoId}</span>
          </Link>
          {/* Stacked tiers below sm. */}
          <div className="flex flex-col gap-1 pt-1 sm:hidden">
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
      <TableCell className="hidden align-top sm:table-cell">
        <div className="flex flex-col gap-0.5">
          <span title={formatAbsoluteUtc(r.committedAt)}>{relativeTime(r.committedAt)}</span>
          <ScanMeta row={r} />
        </div>
      </TableCell>
      <TableCell className="hidden align-top text-right tabular-nums sm:table-cell">
        {r.componentCount.toLocaleString()}
      </TableCell>
      <TableCell
        className={`hidden align-top text-right tabular-nums sm:table-cell ${
          r.deprecatedCount > 0 ? "font-medium text-status-warn-text" : "text-faint"
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

/** The mobile tier's movement line, `+3 −16 · 18 changed · deprecated (−2)`,
 *  with zero parts omitted. Only the deprecated Δ takes `deltaTone`, as in the
 *  desktop cell. */
function MobileMovement({ delta }: { delta: NonNullable<RepoSummary["delta"]> }) {
  const lead = [sinceLastScan(delta), delta.changed > 0 ? `${delta.changed.toLocaleString()} changed` : null]
    .filter((part) => part !== null)
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
    </span>
  );
}

/** The Δ components cell. From lg it reads in words, `+3 added · −16 removed ·
 *  13 changed`, so signs never read as a net sum; below lg it is the compact
 *  `+3 −16 · 13 changed`. Zero parts are omitted; a faint dash when no
 *  component moved, and `first scan` when there is no earlier scan. */
function SinceLastScanCell({ delta }: { delta: RepoSummary["delta"] }) {
  const cell = "hidden align-top text-right tabular-nums sm:table-cell";
  if (delta === null) {
    return (
      <TableCell className={cell}>
        <span className="text-xs text-faint">first scan</span>
      </TableCell>
    );
  }
  const counts = sinceLastScan(delta);
  if (counts === null && delta.changed === 0) {
    return <TableCell className={`${cell} text-faint`}>—</TableCell>;
  }
  return (
    <TableCell className={cell}>
      <span className="hidden text-muted-foreground lg:inline">
        {movementParts(delta).map((p, i) => (
          <span key={p.word}>
            {i > 0 ? " · " : null}
            <span className="font-medium text-foreground">
              {p.word === "changed" ? p.n.toLocaleString() : signedCount(p.word === "added" ? p.n : -p.n)}
            </span>
            {` ${p.word}`}
          </span>
        ))}
      </span>
      <span className="lg:hidden">
        {counts !== null ? <span className="font-medium text-foreground">{counts}</span> : null}
        {delta.changed > 0 ? (
          <span className="text-muted-foreground">
            {counts !== null ? " · " : null}
            <span className="font-medium text-foreground">{delta.changed.toLocaleString()}</span> changed
          </span>
        ) : null}
      </span>
    </TableCell>
  );
}

/** Scan provenance: branch · short sha. With `lead`, the relative time opens
 *  the line (the mobile tier has no Last-scan column to carry it). */
function ScanMeta({ row: r, lead }: { row: RepoSummary; lead?: boolean }) {
  const shortCommit = r.commit ? r.commit.slice(0, 7) : "";
  if (!lead && !r.branch && !shortCommit) return null;
  return (
    // The mobile tier wraps (it shares the name cell's width); the desktop
    // column doesn't, because a wrapped sha doubles the row height.
    <span
      className={`flex items-center gap-x-1.5 gap-y-0.5 text-xs tabular-nums text-muted-foreground ${
        lead ? "flex-wrap whitespace-normal" : "whitespace-nowrap"
      }`}
    >
      {lead ? <span className="text-foreground">{relativeTime(r.committedAt)}</span> : null}
      {lead && r.branch ? <Dot /> : null}
      {r.branch ? <span className="font-mono">{r.branch}</span> : null}
      {(lead || r.branch) && shortCommit ? <Dot /> : null}
      {shortCommit ? <span className="font-mono">{shortCommit}</span> : null}
    </span>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-border">
      ·
    </span>
  );
}
