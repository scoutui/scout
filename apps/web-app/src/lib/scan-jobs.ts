import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { CHART_RESULTS_VERSION, PROJECTION_VERSION, scanModelReady, type ScanModelHeader } from "@scoutui/web-shared";

export const SCAN_JOB_LEASE_MS = 60_000;
export const SCAN_JOB_MAX_ATTEMPTS = 5;
export const UPLOAD_QUEUE_LOCK_KEY = 20_260_923;

export type ScanJobKind = "upload" | "scan" | "results";
export type ClaimedScanJob = {
  id: string; kind: ScanJobKind; leaseToken: string; uploadId: string | null; scanId: string | null; projectionVersion: number; attempt: number; repair: boolean; rescan: boolean;
};
export type ScanJobError = { code: string; message: string };
export type ScanJobStage = "decoding" | "publishing" | "deriving";

export class ScanJobLeaseError extends Error {
  constructor() {
    super("Scan job lease is no longer held");
    this.name = "ScanJobLeaseError";
  }
}

/** A log-safe error class: a SQLSTATE or the error's name, never its message. */
export function errorClass(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  return error instanceof Error ? error.name : "unknown";
}

const exhausted: ScanJobError = { code: "attempts_exhausted", message: "Couldn't upload the scan: the dashboard couldn't finish processing it after several tries. Ask your dashboard administrator to check its logs." };

export const SCAN_JOB_PRIORITY = { upload: 30, latest: 20, history: 10 } as const;

/** Resolves true when a job was inserted, false when one already exists for the scan and projection version. */
export async function enqueueScanJob(client: PoolClient, scanId: string, projectionVersion: number, priority: number): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO scan_jobs (id, kind, scan_id, projection_version, priority)
     VALUES ($1, 'scan', $2, $3, $4) ON CONFLICT (scan_id, projection_version) WHERE scan_id IS NOT NULL DO NOTHING`,
    [randomUUID(), scanId, projectionVersion, priority],
  );
  return result.rowCount === 1;
}

/** Requeues failed current-version scan jobs, optionally only for the given scans, with a fresh attempt budget; resolves the requeued job ids. */
export async function retryFailedScanJobs(pool: Pool, scanIds: string[] | null): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE scan_jobs SET state = 'queued', stage = 'queued', attempts = 0, available_at = now(), error_code = NULL, error_message = NULL, updated_at = now()
     WHERE kind = 'scan' AND state = 'failed' AND projection_version = $1 AND ($2::text[] IS NULL OR scan_id = ANY($2)) RETURNING id`,
    [PROJECTION_VERSION, scanIds],
  );
  return rows.map(row => row.id);
}

export async function uploadQueueFull(db: Pool | PoolClient, maxQueuedUploads: number): Promise<boolean> {
  const { rows: [row] } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM scan_jobs WHERE upload_id IS NOT NULL AND state IN ('queued', 'processing')");
  return (row?.n ?? 0) >= maxQueuedUploads;
}

export async function claimScanJob(pool: Pool, owner: string): Promise<ClaimedScanJob | null> {
  const leaseToken = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`WITH expired AS (
        SELECT id FROM scan_jobs WHERE state = 'processing' AND lease_expires_at <= now() AND attempts >= $1
        FOR UPDATE SKIP LOCKED
      ), failed AS (
        UPDATE scan_jobs AS job SET state = 'failed', stage = 'failed', lease_token = NULL, lease_owner = NULL,
          lease_expires_at = NULL, error_code = $2, error_message = $3, updated_at = now()
        FROM expired WHERE job.id = expired.id RETURNING job.upload_id
      )
      UPDATE scan_uploads AS receipt SET state = 'failed', error_code = $2, error_message = $3, updated_at = now()
      FROM failed WHERE receipt.upload_id = failed.upload_id`,
    [SCAN_JOB_MAX_ATTEMPTS, exhausted.code, exhausted.message]);
    const { rows: [row] } = await client.query<{ id: string; kind: ScanJobKind; upload_id: string | null; scan_id: string | null; projection_version: number; attempts: number; repair: boolean; rescan: boolean }>(
      `WITH candidate AS (
        SELECT id FROM scan_jobs
        WHERE projection_version <= CASE WHEN kind = 'results' THEN $5::int ELSE $4::int END
          AND ((state = 'queued' AND available_at <= now()) OR (state = 'processing' AND lease_expires_at <= now()))
        ORDER BY priority DESC, available_at, sequence
        LIMIT 1 FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE scan_jobs AS job SET state = 'processing', stage = 'claimed', attempts = job.attempts + 1,
          lease_token = $2, lease_owner = $1, lease_expires_at = clock_timestamp() + make_interval(secs => $3::double precision / 1000),
          updated_at = now()
        FROM candidate WHERE job.id = candidate.id
        RETURNING job.id, job.kind, job.upload_id, job.scan_id, job.projection_version, job.attempts, job.repair, job.rescan
      ), receipt AS (
        UPDATE scan_uploads SET state = 'processing', updated_at = now()
        FROM claimed WHERE scan_uploads.upload_id = claimed.upload_id AND scan_uploads.state IN ('queued', 'processing')
      )
      SELECT * FROM claimed`,
      [owner, leaseToken, SCAN_JOB_LEASE_MS, PROJECTION_VERSION, CHART_RESULTS_VERSION],
    );
    await client.query("COMMIT");
    return row ? { id: row.id, kind: row.kind, leaseToken, uploadId: row.upload_id, scanId: row.scan_id, projectionVersion: row.projection_version, attempt: row.attempts, repair: row.repair, rescan: row.rescan } : null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function renewScanJob(pool: Pool, job: ClaimedScanJob): Promise<boolean> {
  const result = await pool.query(`UPDATE scan_jobs SET lease_expires_at = clock_timestamp() + make_interval(secs => $3::double precision / 1000), updated_at = now()
    WHERE id = $1 AND lease_token = $2 AND state = 'processing' AND lease_expires_at > clock_timestamp()`,
  [job.id, job.leaseToken, SCAN_JOB_LEASE_MS]);
  return result.rowCount === 1;
}

export async function setScanJobStage(pool: Pool, job: ClaimedScanJob, stage: ScanJobStage): Promise<void> {
  const result = await pool.query(`UPDATE scan_jobs SET stage = $3, updated_at = now()
    WHERE id = $1 AND lease_token = $2 AND state = 'processing' AND lease_expires_at > clock_timestamp()`,
  [job.id, job.leaseToken, stage]);
  if (result.rowCount !== 1) throw new ScanJobLeaseError();
}

async function requireLease(client: PoolClient, guard: { jobId: string; leaseToken: string }): Promise<void> {
  const { rows: [job] } = await client.query<{ held: boolean }>(
    `SELECT state = 'processing' AND lease_token = $2 AND lease_expires_at > clock_timestamp() AS held
     FROM scan_jobs WHERE id = $1 FOR UPDATE`,
    [guard.jobId, guard.leaseToken],
  );
  if (!job?.held) throw new ScanJobLeaseError();
}

/** Runs inside the caller's publication transaction; throws ScanJobLeaseError unless the lease is still held. */
export async function completeScanJob(
  client: PoolClient, guard: { jobId: string; leaseToken: string },
  receipt: { uploadId: string; scanId: string; state: "ready" | "duplicate"; replaced?: boolean } | null,
): Promise<void> {
  await requireLease(client, guard);
  await client.query(`UPDATE scan_jobs SET state = 'ready', stage = 'ready', lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
    error_code = NULL, error_message = NULL, updated_at = now() WHERE id = $1`, [guard.jobId]);
  if (receipt) {
    await client.query(`UPDATE scan_uploads SET state = $2, scan_id = $3, replaced = $4, error_code = NULL, error_message = NULL, updated_at = now()
      WHERE upload_id = $1`, [receipt.uploadId, receipt.state, receipt.scanId, receipt.replaced === true]);
    if (receipt.state === "duplicate") await client.query("DELETE FROM scan_artifact_chunks WHERE upload_id = $1", [receipt.uploadId]);
  }
}

/** Deletes a finished results job inside the caller's transaction; throws ScanJobLeaseError unless the lease is still held. */
export async function completeResultsJob(client: PoolClient, guard: { jobId: string; leaseToken: string }): Promise<void> {
  await requireLease(client, guard);
  await client.query("DELETE FROM scan_jobs WHERE id = $1 OR (kind = 'results' AND state = 'failed')", [guard.jobId]);
}

async function settleScanJob(pool: Pool, job: ClaimedScanJob, state: "queued" | "failed", delayMs: number, error: ScanJobError | null): Promise<void> {
  const receiptError = state === "failed" ? error : null;
  try {
    await pool.query(`WITH settled AS (
        UPDATE scan_jobs SET state = $3, stage = $3, available_at = now() + make_interval(secs => $4::double precision / 1000),
          lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, error_code = $5, error_message = $6, updated_at = now()
        WHERE id = $1 AND lease_token = $2 AND state = 'processing'
        RETURNING upload_id
      )
      UPDATE scan_uploads AS receipt SET state = $3, error_code = $7, error_message = $8, updated_at = now()
      FROM settled WHERE receipt.upload_id = settled.upload_id`,
    [job.id, job.leaseToken, state, delayMs, error?.code ?? null, error?.message ?? null, receiptError?.code ?? null, receiptError?.message ?? null]);
  } catch (settleError) {
    if ((settleError as { constraint?: unknown }).constraint !== "scan_jobs_results_queued") throw settleError;
    await pool.query("DELETE FROM scan_jobs WHERE id = $1 AND lease_token = $2 AND state = 'processing'", [job.id, job.leaseToken]);
  }
}

export function retryScanJob(pool: Pool, job: ClaimedScanJob, delayMs: number, error: ScanJobError | null): Promise<void> {
  return settleScanJob(pool, job, "queued", delayMs, error);
}

export function failScanJob(pool: Pool, job: ClaimedScanJob, error: ScanJobError): Promise<void> {
  return settleScanJob(pool, job, "failed", 0, error);
}

export type UploadStatus = {
  state: "queued" | "processing" | "ready" | "duplicate" | "failed";
  readable: boolean;
  scanId?: string;
  url?: string;
  replaced?: true;
  stage?: string;
  retryAfterSeconds?: number;
  error?: ScanJobError;
};

/** The dashboard page that shows a repository's scans. */
export function repoScanUrl(repoId: string): string {
  return `/repos/${encodeURIComponent(repoId)}`;
}

const UPLOAD_POLL_SECONDS = 2;
export const processingFailed: ScanJobError = { code: "processing_failed", message: "Couldn't upload the scan: the dashboard hit an error while processing it. Try again, or ask your dashboard administrator to check its logs." };

export async function getUploadStatus(pool: Pool, uploadId: string): Promise<UploadStatus | null> {
  const { rows: [row] } = await pool.query<ScanModelHeader & {
    receipt_state: UploadStatus["state"]; scan_id: string | null; repo_id: string | null;
    error_code: string | null; error_message: string | null; replaced: boolean; stage: string | null; wait_seconds: number | null;
  }>(`SELECT receipt.state AS receipt_state, receipt.error_code, receipt.error_message, receipt.replaced, scans.scan_id, scans.repo_id,
      job.stage, GREATEST(0, CEIL(EXTRACT(EPOCH FROM job.available_at - now())))::int AS wait_seconds,
      model.state, model.projection_version, model.format_version, model.build_revision,
      model.expected_counts, model.actual_counts, model.details_retained
    FROM scan_uploads AS receipt
    LEFT JOIN scans ON scans.scan_id = receipt.scan_id
    LEFT JOIN scan_read_models AS model ON model.scan_id = receipt.scan_id
    LEFT JOIN LATERAL (
      SELECT stage, available_at FROM scan_jobs WHERE scan_jobs.upload_id = receipt.upload_id ORDER BY created_at DESC LIMIT 1
    ) AS job ON true
    WHERE receipt.upload_id = $1 AND receipt.state <> 'receiving'`, [uploadId]);
  if (!row) return null;
  const state = row.receipt_state;
  if (state === "failed") {
    const error = row.error_code && row.error_message ? { code: row.error_code, message: row.error_message } : processingFailed;
    return { state, readable: false, error };
  }
  if (state === "queued" || state === "processing") {
    return { state, readable: false, stage: row.stage ?? state, retryAfterSeconds: Math.max(UPLOAD_POLL_SECONDS, row.wait_seconds ?? 0) };
  }
  if (!row.scan_id || !row.repo_id) return { state, readable: false, stage: "preparing", retryAfterSeconds: UPLOAD_POLL_SECONDS };
  const scan = { scanId: row.scan_id, url: repoScanUrl(row.repo_id), ...(row.replaced ? { replaced: true as const } : {}) };
  if (scanModelReady(row)) return { state, readable: true, ...scan };
  return { state, readable: false, ...scan, stage: "preparing", retryAfterSeconds: UPLOAD_POLL_SECONDS };
}
