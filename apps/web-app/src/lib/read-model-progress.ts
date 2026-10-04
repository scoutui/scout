import type { Pool } from "pg";
import { PostgresDriver, type SkippedScan, type SkippedScans } from "@scoutui/web-shared";
import type { ChartResultsNotice, ReadModelUnavailable, ScanFallbackNotice, SkippedNotices, SkippedState } from "./read-model-state.ts";

/**
 * `committedAt`: the scan's commit date. `degradedReason`: why the stored source of a scan whose newest job failed
 * can't be decoded; null otherwise.
 */
export type ReadModelProgress = {
  scanId: string; repoId: string; commit: string; committedAt: string; failed: boolean; degradedReason: string | null;
};

const DEGRADED_PREFIX = "degraded: ";

/** Each scan's repo and commit, and whether its newest rebuild job failed, in the order given. */
export async function getReadModelProgress(pool: Pool, scanIds: string[]): Promise<ReadModelProgress[]> {
  if (!scanIds.length) return [];
  const { rows } = await pool.query<{
    scan_id: string; repo_id: string; commit_sha: string; committed_at: Date | string; failed: boolean; error_message: string | null;
  }>(
    `SELECT id.scan_id, scans.repo_id, scans.commit_sha, scans.committed_at, job.state IS NOT DISTINCT FROM 'failed' AS failed, job.error_message
     FROM unnest($1::text[]) WITH ORDINALITY AS id(scan_id, position)
     JOIN scans ON scans.scan_id = id.scan_id
     LEFT JOIN LATERAL (
       SELECT state, error_message FROM scan_jobs WHERE scan_jobs.scan_id = id.scan_id ORDER BY sequence DESC LIMIT 1
     ) AS job ON true
     ORDER BY id.position`,
    [scanIds],
  );
  return rows.map(row => ({
    scanId: row.scan_id,
    repoId: row.repo_id,
    commit: row.commit_sha,
    committedAt: new Date(row.committed_at).toISOString(),
    failed: row.failed,
    degradedReason: row.failed && row.error_message?.startsWith(DEGRADED_PREFIX) ? row.error_message.slice(DEGRADED_PREFIX.length) : null,
  }));
}

/** The scans that can't be read, or failed to rebuild when none can't be read; null when every scan is still preparing. */
export function unavailableScans(progress: ReadModelProgress[]): ReadModelUnavailable | null {
  const failed = progress.filter(scan => scan.failed);
  const degraded = failed.filter(scan => scan.degradedReason !== null);
  const listed = degraded.length ? degraded : failed;
  if (!listed.length) return null;
  return {
    state: degraded.length ? "degraded" : "failed",
    scans: listed.map(({ scanId, repoId, commit }) => ({ scanId, repoId, commit })),
    retryable: false,
  };
}

/** Whether a scan that isn't ready can't be read, failed to prepare, or is still being prepared. */
export function skippedState(scan: ReadModelProgress): SkippedState {
  if (scan.degradedReason !== null) return "degraded";
  return scan.failed ? "failed" : "preparing";
}

/**
 * What a page says about the scans its read skipped. Null when a skipped scan is being rebuilt and hasn't failed,
 * with no scan shown in its place: after a deploy that changes how scan data is stored, the page waits for the rebuild.
 */
export async function skippedNotices(pool: Pool, skipped: SkippedScans): Promise<SkippedNotices | null> {
  const ids = [
    ...skipped.fallbacks.flatMap(fallback => [...fallback.skipped.map(scan => scan.scanId), ...(fallback.shownScanId ? [fallback.shownScanId] : [])]),
    ...skipped.gaps.map(gap => gap.scanId),
  ];
  const progress = new Map((await getReadModelProgress(pool, ids)).map(scan => [scan.scanId, scan]));
  const rebuilding = (scans: SkippedScan[]) => scans.some(scan => scan.rebuilding && progress.get(scan.scanId)?.failed === false);
  if (skipped.fallbacks.some(fallback => fallback.shownScanId === null && rebuilding(fallback.skipped)) || rebuilding(skipped.gaps)) return null;
  const listed = ({ scanId, repoId, commit }: ReadModelProgress) => ({ scanId, repoId, commit });
  return {
    fallbacks: skipped.fallbacks.flatMap(fallback => {
      const latest = progress.get(fallback.skipped[0]?.scanId ?? "");
      const shown = fallback.shownScanId ? progress.get(fallback.shownScanId) : null;
      if (!latest || shown === undefined) return [];
      return [{
        repoId: fallback.repoId, state: skippedState(latest), latest: listed(latest),
        shown: shown ? { commit: shown.commit, committedAt: shown.committedAt } : null,
      }];
    }),
    gaps: skipped.gaps.flatMap(gap => {
      const scan = progress.get(gap.scanId);
      return scan ? [{ ...listed(scan), state: skippedState(scan) }] : [];
    }),
  };
}

/** The repos whose newest scan failed or can't be read, with the scan shown in its place, as a read of every repo's latest scan finds them. */
async function failedFallbacks(pool: Pool): Promise<ScanFallbackNotice[]> {
  const notices = await skippedNotices(pool, { fallbacks: await new PostgresDriver(pool).latestScanFallbacks(), gaps: [] });
  return (notices?.fallbacks ?? []).filter(fallback => fallback.state !== "preparing");
}

/**
 * Why stored chart results cannot be current: failed when a repo's newest scan failed or can't be read (listing
 * those scans) or when the newest results job failed, otherwise preparing.
 */
export async function chartResultsUnavailable(pool: Pool): Promise<ReadModelUnavailable> {
  const failed = await failedFallbacks(pool);
  const degraded = failed.filter(fallback => fallback.state === "degraded");
  const listed = degraded.length ? degraded : failed;
  if (listed.length) return { state: degraded.length ? "degraded" : "failed", scans: listed.map(fallback => fallback.latest), retryable: false };
  return await resultsJobState(pool) === "failed"
    ? { state: "failed", scans: [], retryable: false }
    : { state: "preparing", scans: [], retryable: true };
}

/** Whether the newest results job is still to run or running, or failed; null when none is left. */
async function resultsJobState(pool: Pool): Promise<"pending" | "failed" | null> {
  const { rows: [results] } = await pool.query<{ state: string }>(
    "SELECT state FROM scan_jobs WHERE kind = 'results' ORDER BY sequence DESC LIMIT 1");
  if (results?.state === "failed") return "failed";
  return results?.state === "queued" || results?.state === "processing" ? "pending" : null;
}

/**
 * What a stored-results surface shows. With nothing stored, any unavailable state. Beside stored results, the repos
 * whose newest scan failed or can't be read, and a failed or pending results job; null when there's none of these.
 */
export async function chartResultsNotice(pool: Pool, stored: boolean): Promise<ChartResultsNotice | null> {
  if (!stored) return { unavailable: await chartResultsUnavailable(pool), fallbacks: [] };
  const job = await resultsJobState(pool);
  const unavailable: ReadModelUnavailable | null = job === "failed" ? { state: "failed", scans: [], retryable: false }
    : job === "pending" ? { state: "preparing", scans: [], retryable: true } : null;
  const fallbacks = await failedFallbacks(pool);
  return unavailable || fallbacks.length ? { unavailable, fallbacks } : null;
}
