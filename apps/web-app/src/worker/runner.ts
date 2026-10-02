import { setTimeout as sleep } from "node:timers/promises";
import type { Pool } from "pg";
import { validateArtifact } from "@scoutui/scan-format";
import { processChartResultsJob } from "../lib/chart-results-job";
import { decodeCanonicalSource } from "../lib/stored-artifact";
import { acceptScan, versionRefusal, type Refusal } from "../lib/scan-acceptance";
import {
  claimScanJob, errorClass, failScanJob, processingFailed, renewScanJob, retryScanJob, setScanJobStage, SCAN_JOB_LEASE_MS, SCAN_JOB_MAX_ATTEMPTS,
  ScanJobLeaseError, type ClaimedScanJob,
} from "../lib/scan-jobs";
import { publishScanSource, republishScan, type ScanSource } from "../lib/scan-projection";
import { scanUploadConfig } from "../lib/scan-upload-config";
import { ScanValidationError } from "../lib/scan-validation";

export const SCAN_JOB_RENEW_MS = SCAN_JOB_LEASE_MS / 3;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

function log(job: ClaimedScanJob, event: string): void {
  console.log(`[worker] job ${job.id} attempt ${job.attempt} ${event}`);
}

/** A refused scan as the job's permanent failure. A null refusal, which the version branches never pass, falls back to the code's default message. */
function refusalError(refusal: Refusal | null): ScanValidationError {
  return refusal ? new ScanValidationError(refusal.code, refusal.message) : new ScanValidationError("unsupported_version");
}

function invalidScan(path: string): ScanValidationError {
  return new ScanValidationError("invalid_artifact", undefined, path);
}

async function decodeUpload(pool: Pool, uploadId: string, signal: AbortSignal): Promise<{ source: ScanSource; uploadedByUserId: string | null }> {
  const client = await pool.connect();
  try {
    const { rows: [receipt] } = await client.query<{ uploaded_by_user_id: string | null }>(
      "SELECT uploaded_by_user_id FROM scan_uploads WHERE upload_id = $1", [uploadId]);
    signal.throwIfAborted();
    const decoded = await decodeCanonicalSource(client, { uploadId }, scanUploadConfig().maxDecodedBytes);
    signal.throwIfAborted();
    if (!decoded) throw new ScanValidationError("invalid_artifact");
    if ("unknown" in decoded) {
      if (decoded.reason === "unsupported_version") throw refusalError(versionRefusal(decoded.version));
      if (decoded.reason === "invalid_artifact") throw invalidScan("meta.schemaVersion");
      throw new ScanValidationError(decoded.reason);
    }
    const validated = validateArtifact(decoded.artifact);
    if (!validated.ok) {
      if (validated.reason === "unsupported_version") throw refusalError(versionRefusal(validated.version));
      throw invalidScan(validated.path);
    }
    const artifact = validated.artifact;
    const refusal = acceptScan({ schemaVersion: artifact.meta.schemaVersion, scannerName: artifact.meta.scannerName });
    if (refusal) throw refusalError(refusal);
    return { source: { meta: artifact.meta, artifact }, uploadedByUserId: receipt?.uploaded_by_user_id ?? null };
  } finally {
    client.release();
  }
}

/** Processes one claimed job to a fenced publication, a scheduled retry, a permanent failure or a released lease. */
export async function processScanJob(pool: Pool, job: ClaimedScanJob, signal: AbortSignal): Promise<void> {
  const lease = new AbortController();
  const heartbeat = setInterval(() => {
    renewScanJob(pool, job).then(
      held => { if (!held) lease.abort(new ScanJobLeaseError()); },
      () => console.error(`[worker] job ${job.id} lease renewal failed`),
    );
  }, SCAN_JOB_RENEW_MS);
  const aborted = AbortSignal.any([signal, lease.signal]);
  const guard = { jobId: job.id, leaseToken: job.leaseToken };
  log(job, "claimed");
  try {
    if (job.kind === "results") {
      const started = performance.now();
      const outcome = await processChartResultsJob(pool, job, aborted);
      log(job, `ready results ${outcome} in ${Math.round(performance.now() - started)}ms`);
    } else if (job.uploadId) {
      await setScanJobStage(pool, job, "decoding");
      log(job, "decoding");
      const upload = await decodeUpload(pool, job.uploadId, aborted);
      await setScanJobStage(pool, job, "publishing");
      log(job, "publishing");
      const result = await publishScanSource(pool, upload.source, { uploadedByUserId: upload.uploadedByUserId, sourceUploadId: job.uploadId, guard, signal: aborted, rescan: job.rescan });
      log(job, `ready ${result.status}`);
    } else if (job.scanId) {
      await setScanJobStage(pool, job, "publishing");
      log(job, "publishing");
      const result = await republishScan(pool, job.scanId, { guard, signal: aborted, force: job.repair });
      log(job, result ? `ready ${result.status}` : "scan missing");
    }
  } catch (error) {
    if (lease.signal.aborted || error instanceof ScanJobLeaseError) {
      log(job, "lease lost");
    } else if (signal.aborted) {
      await retryScanJob(pool, job, 0, null);
      log(job, "released");
    } else if (error instanceof ScanValidationError) {
      await failScanJob(pool, job, { code: error.code, message: error.message });
      log(job, `failed ${error.code}${error.path ? ` at ${error.path}` : ""}`);
    } else if (job.attempt >= SCAN_JOB_MAX_ATTEMPTS) {
      await failScanJob(pool, job, processingFailed);
      log(job, `failed ${processingFailed.code} (${errorClass(error)})`);
    } else {
      const delayMs = Math.min(RETRY_BASE_MS * 2 ** (job.attempt - 1), RETRY_MAX_MS);
      await retryScanJob(pool, job, delayMs, processingFailed);
      log(job, `retrying in ${delayMs}ms (${errorClass(error)})`);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

/** Claims and processes one job at a time until the signal aborts; an in-flight job is released on abort. */
export async function runScanJobs(pool: Pool, options: { owner: string; signal: AbortSignal; idleMs?: number }): Promise<void> {
  const idleMs = options.idleMs ?? 1000;
  while (!options.signal.aborted) {
    let claimed = false;
    try {
      const job = await claimScanJob(pool, options.owner);
      if (job) {
        claimed = true;
        await processScanJob(pool, job, options.signal);
      }
    } catch (error) {
      console.error(`[worker] scan job loop failed (${errorClass(error)})`);
    }
    if (!claimed) await sleep(idleMs, undefined, { signal: options.signal }).catch(() => {});
  }
}
