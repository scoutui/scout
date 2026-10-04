import type { Pool, PoolClient } from "pg";
import {
  CHART_RESULTS_FORMAT_VERSION, CHART_RESULTS_VERSION, chartResultKey, enqueueChartResults, newestScanFirstSql, PROJECTION_VERSION,
  READ_MODEL_FORMAT_VERSION,
} from "@scoutui/web-shared";
import { enqueueScanJob, SCAN_JOB_PRIORITY } from "./scan-jobs.ts";

export type ReconcileResult = { inspected: number; enqueued: number; hasMore: boolean };

const rankedScans = `WITH ranked AS (
    SELECT scan_id, repo_id, committed_at, created_at, branch_position,
      ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY ${newestScanFirstSql()}) = 1 AS latest
    FROM scans
  )`;

function jobPriority(latest: boolean): number {
  return latest ? SCAN_JOB_PRIORITY.latest : SCAN_JOB_PRIORITY.history;
}

async function requeueReadyScanJob(client: PoolClient, scanId: string, priority: number): Promise<boolean> {
  const result = await client.query(`UPDATE scan_jobs SET state = 'queued', stage = 'queued', attempts = 0, priority = $3, repair = false, available_at = now(),
      error_code = NULL, error_message = NULL, updated_at = now()
    WHERE kind = 'scan' AND scan_id = $1 AND projection_version = $2 AND state = 'ready'`, [scanId, PROJECTION_VERSION, priority]);
  return result.rowCount === 1;
}

/**
 * Enqueues current-version jobs for up to `batchSize` scans whose read model is missing, not ready, outdated,
 * or is a repo's latest scan without retained details. A scan whose current-version job is ready has that job
 * requeued; one whose current-version job is queued, processing or failed is skipped. Each repo's latest scan
 * comes first, then history newest first. `scanIds` limits the pass to those scans.
 */
export async function reconcileScanJobs(pool: Pool, batchSize: number, scanIds: string[] | null = null): Promise<ReconcileResult> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ scan_id: string; latest: boolean; job_ready: boolean }>(`
      ${rankedScans}
      SELECT ranked.scan_id, ranked.latest, job.state IS NOT NULL AS job_ready FROM ranked
      LEFT JOIN scan_read_models AS model USING (scan_id)
      LEFT JOIN scan_jobs AS job ON job.scan_id = ranked.scan_id AND job.projection_version = $1
      WHERE (model.scan_id IS NULL OR model.state <> 'ready' OR model.projection_version < $1
          OR model.format_version < $2 OR (ranked.latest AND NOT model.details_retained))
        AND (job.state IS NULL OR job.state = 'ready')
        AND ($4::text[] IS NULL OR ranked.scan_id = ANY($4))
      ORDER BY ranked.latest DESC, ${newestScanFirstSql("ranked")}
      LIMIT $3`, [PROJECTION_VERSION, READ_MODEL_FORMAT_VERSION, batchSize + 1, scanIds]);
    const batch = rows.slice(0, batchSize);
    let enqueued = 0;
    for (const row of batch) {
      if (row.job_ready ? await requeueReadyScanJob(client, row.scan_id, jobPriority(row.latest))
        : await enqueueScanJob(client, row.scan_id, PROJECTION_VERSION, jobPriority(row.latest))) enqueued++;
    }
    return { inspected: batch.length, enqueued, hasMore: rows.length > batchSize };
  } finally {
    client.release();
  }
}

/**
 * Queues a forced same-version republication for every scan, or only `scanIds`: completed current-version jobs are
 * requeued with a fresh attempt budget and scans without a current-version job get one. Resolves the queued job ids.
 */
export async function repairScanJobs(pool: Pool, scanIds: string[] | null): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: missing } = await client.query<{ scan_id: string; latest: boolean }>(`
      ${rankedScans}
      SELECT scan_id, latest FROM ranked
      WHERE ($2::text[] IS NULL OR scan_id = ANY($2))
        AND NOT EXISTS (SELECT 1 FROM scan_jobs WHERE scan_jobs.scan_id = ranked.scan_id AND scan_jobs.projection_version = $1)`,
    [PROJECTION_VERSION, scanIds]);
    for (const row of missing) await enqueueScanJob(client, row.scan_id, PROJECTION_VERSION, jobPriority(row.latest));
    const { rows } = await client.query<{ id: string }>(`
      UPDATE scan_jobs SET state = 'queued', stage = 'queued', attempts = 0, repair = true, available_at = now(),
        error_code = NULL, error_message = NULL, updated_at = now()
      WHERE kind = 'scan' AND projection_version = $1 AND ($2::text[] IS NULL OR scan_id = ANY($2))
        AND (state = 'ready' OR (state = 'queued' AND scan_id = ANY($3)))
      RETURNING id`, [PROJECTION_VERSION, scanIds, missing.map(row => row.scan_id)]);
    await client.query("COMMIT");
    return rows.map(row => row.id);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Enqueues a results job when the stored chart results are missing, were built by an older version or are more than
 * a day old, and none is queued; true when a row was written.
 */
export async function reconcileChartResults(pool: Pool): Promise<boolean> {
  const { rows: [row] } = await pool.query<{ stale: boolean }>(`
    SELECT (NOT EXISTS (SELECT 1 FROM chart_results WHERE key = $1)
        OR EXISTS (SELECT 1 FROM chart_results WHERE results_version < $2 OR format_version <> $3
          OR snapshot_at < now() - interval '1 day'))
      AND NOT EXISTS (SELECT 1 FROM scan_jobs WHERE kind = 'results' AND state = 'queued') AS stale`,
  [chartResultKey.registry, CHART_RESULTS_VERSION, CHART_RESULTS_FORMAT_VERSION]);
  return Boolean(row?.stale) && await enqueueChartResults(pool);
}
