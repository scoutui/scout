import type { GovernanceRecord } from "./dto.js";
import type { DigestScan } from "./digest.js";
import { deriveGovernanceTracking } from "./governance-tracking.js";
import { successorDeprecated } from "./governance-integrity.js";

/**
 * A record's state on the registry: whether it matches any scan, whether it is
 * still doing work, and where its numbers live. Percentages, deltas and series
 * belong on the tracking page `trackingId` links to.
 */
export type RecordStat = {
  status: "active" | "complete" | "unseen";
  /** Repos whose latest scan still shows the deprecated side. */
  repos: number;
  /** Derived tracking id (`migration:<id>` / `retirement:<id>`); null when the record never matched a scan. */
  trackingId: string | null;
  /** The successor is itself governed (a chain). */
  successorDeprecated: boolean;
};

export type RegistryStats = {
  stats: Record<string, RecordStat>;
  /** Distinct repos in the estate. Below 2, the registry leaves out its coverage copy. */
  repoCount: number;
};

/**
 * Per-record registry state. The estate-scoped tracking derivation gives
 * lifecycle status and the tracking edge; per-repo derivations give coverage;
 * a record the estate derivation skips has never matched a scan (often a typo).
 * Every record gets an entry, unseen ones included.
 */
export function deriveRecordStats(
  records: GovernanceRecord[],
  scans: DigestScan[],
): RegistryStats {
  const estate = new Map(
    deriveGovernanceTracking(records, scans, { kind: "all" }).map((e) => [e.record.id, e]),
  );

  const repoIds = [...new Set(scans.map((d) => d.meta.repo.id))];
  const activeRepos = new Map<string, number>();
  for (const repoId of repoIds) {
    for (const e of deriveGovernanceTracking(records, scans, { kind: "repo", repoId })) {
      if (e.active) activeRepos.set(e.record.id, (activeRepos.get(e.record.id) ?? 0) + 1);
    }
  }

  const stats: Record<string, RecordStat> = {};
  for (const r of records) {
    const entry = estate.get(r.id);
    stats[r.id] = entry
      ? {
          status: entry.active ? "active" : "complete",
          repos: activeRepos.get(r.id) ?? 0,
          trackingId: entry.id,
          successorDeprecated: successorDeprecated(r, records),
        }
      : { status: "unseen", repos: 0, trackingId: null, successorDeprecated: successorDeprecated(r, records) };
  }

  return { stats, repoCount: repoIds.length };
}
