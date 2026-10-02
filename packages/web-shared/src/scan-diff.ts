import type { ComponentDigest, DigestScan } from "./digest.js";
import type { DiffMark, GovernanceRecord, RemovedComponent, RepoDelta, ScanDiff, Tag } from "./dto.js";
import { displayNameOf } from "@scoutui/scan-format";
import { componentDeprecated } from "./governance.js";
import { presentIdentity } from "./present-identity.js";
import { newestScanFirst } from "./scan-order.js";
import { resolveTags } from "./tags.js";

/**
 * The scan diff: what moved between two digest scans of one repo, keyed by
 * component id. Deprecation comes from `componentDeprecated`, and a removed
 * component's tags from `resolveTags`.
 */

/** One component over one scan: its occurrences and deprecation. */
type Entry = { occ: number; deprecated: boolean; component: ComponentDigest };

function byComponent(scan: DigestScan, governance: GovernanceRecord[]): Map<string, Entry> {
  return new Map(scan.components.map((c) => [c.id, { occ: c.stats.occurrenceCount, deprecated: componentDeprecated(c, governance), component: c }]));
}

export function diffDigests(current: DigestScan, previous: DigestScan, governance: GovernanceRecord[], tags: Tag[]): ScanDiff {
  const now = byComponent(current, governance);
  const then = byComponent(previous, governance);
  const marks: Record<string, DiffMark> = {};
  const removedRows: RemovedComponent[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let deprecatedPrev = 0;
  let deprecatedNow = 0;

  for (const [id, a] of now) {
    if (a.deprecated) deprecatedNow++;
    const b = then.get(id);
    if (b === undefined) {
      marks[id] = { kind: "added" };
      added++;
    } else if (b.occ !== a.occ) {
      marks[id] = { kind: "changed", delta: a.occ - b.occ };
      changed++;
    }
  }

  for (const [id, b] of then) {
    if (b.deprecated) deprecatedPrev++;
    if (now.has(id)) continue;
    marks[id] = { kind: "removed" };
    removed++;
    const { packageName, scope, kind } = presentIdentity(b.component);
    removedRows.push({
      componentId: id,
      displayName: displayNameOf(b.component),
      packageName,
      scope,
      kind,
      occurrenceCount: b.occ,
      deprecated: b.deprecated,
      // Resolved against the current tag rules, by the removed component's own package.
      tags: resolveTags(packageName, tags),
    });
  }
  removedRows.sort((x, y) => y.occurrenceCount - x.occurrenceCount || x.displayName.localeCompare(y.displayName));

  return {
    baselineScanId: previous.meta.scanId,
    baselineCommittedAt: previous.meta.committedAt,
    marks,
    added,
    removed,
    changed,
    removedRows,
    deprecatedPrev,
    deprecatedNow,
  };
}

export function repoDelta(diff: ScanDiff): RepoDelta {
  return { added: diff.added, removed: diff.removed, changed: diff.changed, deprecated: diff.deprecatedNow - diff.deprecatedPrev };
}

function newestFirst(digests: DigestScan[]): DigestScan[] {
  return [...digests].sort((a, b) => newestScanFirst(a.meta, b.meta));
}

/**
 * The diff for `scanId` against the scan immediately before it in `digests`
 * (one repo's history, any order). Null on a first scan, or when `scanId` is
 * not in the set: a scan whose digest rows were never written has nothing to
 * compare, rather than everything added.
 */
export function diffForScan(digests: DigestScan[], scanId: string, governance: GovernanceRecord[], tags: Tag[]): ScanDiff | null {
  const ordered = newestFirst(digests);
  const i = ordered.findIndex((d) => d.meta.scanId === scanId);
  if (i === -1) return null;
  const current = ordered[i];
  const previous = ordered[i + 1];
  if (current === undefined || previous === undefined) return null;
  return diffDigests(current, previous, governance, tags);
}

/** repoId → delta of its newest scan against the one before; null with fewer than two scans. */
export function repoDeltas(digests: DigestScan[], governance: GovernanceRecord[], tags: Tag[]): Map<string, RepoDelta | null> {
  const byRepo = new Map<string, DigestScan[]>();
  for (const d of digests) {
    const list = byRepo.get(d.meta.repo.id);
    if (list !== undefined) list.push(d);
    else byRepo.set(d.meta.repo.id, [d]);
  }
  const out = new Map<string, RepoDelta | null>();
  for (const [repoId, scans] of byRepo) {
    const newest = newestFirst(scans)[0];
    const diff = newest === undefined ? null : diffForScan(scans, newest.meta.scanId, governance, tags);
    out.set(repoId, diff === null ? null : repoDelta(diff));
  }
  return out;
}

/** Rows the changed view shows: every marked component (added + changed + removed). */
export function scanDiffRowCount(diff: ScanDiff): number {
  return diff.added + diff.changed + diff.removed;
}

export function scanDiffMoved(diff: ScanDiff): boolean {
  return scanDiffRowCount(diff) > 0 || diff.deprecatedNow !== diff.deprecatedPrev;
}

export function repoDeltaMoved(delta: RepoDelta): boolean {
  return delta.added !== 0 || delta.removed !== 0 || delta.changed !== 0 || delta.deprecated !== 0;
}
