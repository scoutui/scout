import type { ComponentRow, DiffMark, RemovedComponent, RepoDelta } from "@scoutui/web-shared";
import { deltaDirection } from "@/lib/dashboard-format";

/** `+3`, `−16` (U+2212), or a faint-dash `—` for zero. Never `±0`. */
export function signedCount(n: number): string {
  if (n > 0) return `+${n.toLocaleString()}`;
  if (n < 0) return `−${Math.abs(n).toLocaleString()}`;
  return "—";
}

/** The movement words in the masthead's order, `added · removed · changed`,
 *  zero parts omitted. Every movement readout uses this order. */
export function movementParts(counts: { added: number; removed: number; changed: number }): { word: "added" | "removed" | "changed"; n: number }[] {
  return (["added", "removed", "changed"] as const).map((word) => ({ word, n: counts[word] })).filter((p) => p.n > 0);
}

/** `+3 −16`, zero parts omitted; null when neither count moved. */
export function sinceLastScan(delta: RepoDelta): string | null {
  const parts = [delta.added, -delta.removed].filter((n) => n !== 0).map((n) => signedCount(n));
  return parts.length === 0 ? null : parts.join(" ");
}

/** A row's signed occurrence Δ under its mark: added rows gained everything
 *  they have, removed rows lost everything they had. */
export function deltaOf(mark: DiffMark | undefined, occurrenceCount: number): number {
  if (mark === undefined) return 0;
  switch (mark.kind) {
    case "added":
      return occurrenceCount;
    case "removed":
      return -occurrenceCount;
    case "changed":
      return mark.delta;
  }
}

/** Ink for a signed occurrence Δ. A deprecated component (retired or superseded)
 *  takes its direction from `deltaDirection`: more occurrences is red,
 *  and fewer stays plain ink, since green beside the orange deprecated marker reads
 *  as a flag. Anything else stays neutral ink, because nothing declares whether up
 *  is good. */
export function deltaTone(delta: number, deprecated: boolean): string {
  if (!deprecated) return "text-foreground";
  switch (deltaDirection(delta)) {
    case "backward":
      return "text-status-err";
    case "forward":
      return "text-foreground";
    case "none":
      return "text-foreground";
  }
}

/**
 * The previous scan's vanished component as a table row, so the changed view
 * can facet and sort it through the one path every row takes. The table
 * renders it as an unlinked ghost because its mark is `removed`, not because
 * of anything on the row.
 */
export function ghostRow(removed: RemovedComponent): ComponentRow {
  return {
    componentId: removed.componentId,
    kind: removed.kind,
    scope: removed.scope,
    packageName: removed.packageName,
    displayName: removed.displayName,
    disambiguator: null,
    version: null,
    occurrenceCount: removed.occurrenceCount,
    fileCount: 0,
    deprecated: removed.deprecated,
    tags: removed.tags,
  };
}
