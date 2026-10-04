import type { GovernanceRecord } from "./dto.js";
import type { DigestScan } from "./digest.js";
import { deriveGovernanceTracking } from "./governance-tracking.js";
import { successorDeprecated } from "./governance-integrity.js";
import { governedComponentIds } from "./governance.js";
import { latestScanPerRepo } from "./scan-order.js";

/**
 * A record's state on the registry: whether it matches any scan, whether it is
 * still doing work, how much of what it covers is left and where, which
 * components it covers, and where its numbers live. Percentages, deltas and
 * series belong on the tracking page `trackingId` links to.
 */
export type RecordStat = {
  status: "active" | "complete" | "unseen";
  /** Occurrences of what the record covers, summed over each repo's latest scan. */
  left: number;
  /** Repos whose latest scan still has some, by repo id, sorted. */
  leftIn: string[];
  /** Components the record covers in each repo's latest scan, by id, sorted. */
  componentIds: string[];
  /** Derived tracking id (`migration:<id>` / `retirement:<id>`); null when the record never matched a scan. */
  trackingId: string | null;
  /** The successor is itself governed (a chain). */
  successorDeprecated: boolean;
};

export type RegistryStats = {
  stats: Record<string, RecordStat>;
  /** Distinct repos with a scan. */
  repoCount: number;
};

/**
 * Per-record registry state. The estate-scoped tracking derivation gives
 * lifecycle status, the occurrences left and the tracking edge; per-repo
 * derivations give the repos still using it; each repo's latest scan gives the
 * components it covers. A record the estate derivation skips has never matched
 * a scan (often a typo). Every record gets an entry, unseen ones included.
 */
export function deriveRecordStats(
  records: GovernanceRecord[],
  scans: DigestScan[],
  asOf: string,
): RegistryStats {
  const estate = new Map(
    deriveGovernanceTracking(records, scans, { kind: "all" }, asOf).map((e) => [e.record.id, e]),
  );

  const repoIds = [...new Set(scans.map((d) => d.meta.repo.id))];
  const leftIn = new Map<string, string[]>();
  for (const repoId of repoIds) {
    for (const e of deriveGovernanceTracking(records, scans, { kind: "repo", repoId }, asOf)) {
      if (e.active) leftIn.set(e.record.id, [...(leftIn.get(e.record.id) ?? []), repoId]);
    }
  }
  const latest = latestScanPerRepo(scans);

  const stats: Record<string, RecordStat> = {};
  for (const r of records) {
    const entry = estate.get(r.id);
    const chained = successorDeprecated(r, records);
    stats[r.id] = entry
      ? {
          status: entry.active ? "active" : "complete",
          left: entry.remaining,
          leftIn: [...(leftIn.get(r.id) ?? [])].sort(),
          componentIds: [...new Set(latest.flatMap((scan) => [...governedComponentIds(r, scan, records)]))].sort(),
          trackingId: entry.id,
          successorDeprecated: chained,
        }
      : { status: "unseen", left: 0, leftIn: [], componentIds: [], trackingId: null, successorDeprecated: chained };
  }

  return { stats, repoCount: repoIds.length };
}
