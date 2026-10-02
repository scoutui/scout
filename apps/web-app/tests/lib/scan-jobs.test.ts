import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECTION_VERSION } from "@scoutui/web-shared";
import { claimScanJob, enqueueScanJob, failScanJob, renewScanJob, retryScanJob, SCAN_JOB_MAX_ATTEMPTS, SCAN_JOB_PRIORITY, type ClaimedScanJob } from "@/lib/scan-jobs";
import { publishScan } from "@/lib/scan-projection";
import { openReadModelDatabase, withReadModelDatabase } from "../helpers/read-model-db";
import { receiveArtifact, sampleArtifact } from "../helpers/scan-artifact";

// biome-ignore lint/complexity/useLiteralKeys: env access
const databaseUrl = process.env["DATABASE_URL"];
describe.skipIf(!databaseUrl)("scan job targets", () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  beforeAll(async () => { database = openReadModelDatabase(); pool = await database.pool; });
  beforeEach(async () => {
    await pool.query("TRUNCATE repos, scan_uploads, scan_jobs CASCADE");
    await pool.query("INSERT INTO repos (repo_id) VALUES ('test-repo')");
    await pool.query(`INSERT INTO scans (scan_id, repo_id, committed_at, commit_sha, scanner_version) VALUES ('scan-a', 'test-repo', now(), 'abc', '0')`);
  });
  afterAll(async () => { await database.close(); });

  it("deduplicates target and projection version even after completion", async () => {
    const client = await pool.connect();
    try {
      expect(await enqueueScanJob(client, "scan-a", 3, SCAN_JOB_PRIORITY.history)).toBe(true);
      await pool.query("UPDATE scan_jobs SET state = 'ready'");
      expect(await enqueueScanJob(client, "scan-a", 3, SCAN_JOB_PRIORITY.latest)).toBe(false);
      expect(await enqueueScanJob(client, "scan-a", 4, SCAN_JOB_PRIORITY.history)).toBe(true);
      const { rows } = await pool.query("SELECT projection_version, state FROM scan_jobs ORDER BY projection_version");
      expect(rows).toEqual([{ projection_version: 3, state: "ready" }, { projection_version: 4, state: "queued" }]);
    } finally { client.release(); }
  });

  it("claims jobs enqueued together in enqueue order", async () => {
    const scanIds = Array.from({ length: 8 }, (_, index) => `scan-${index}`);
    for (const scanId of scanIds) {
      await pool.query(`INSERT INTO scans (scan_id, repo_id, committed_at, commit_sha, scanner_version) VALUES ($1, 'test-repo', now(), $1, '0')`, [scanId]);
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const scanId of scanIds) await enqueueScanJob(client, scanId, PROJECTION_VERSION, SCAN_JOB_PRIORITY.history);
      await client.query("COMMIT");
    } finally { client.release(); }
    const claimed = [];
    for (let job = await claimScanJob(pool, "a"); job; job = await claimScanJob(pool, "a")) claimed.push(job.scanId);
    expect(claimed).toEqual(scanIds);
  });

  it("requires the target its kind names and rejects oversized archive rows", async () => {
    await pool.query("INSERT INTO scan_uploads (upload_id, encoding) VALUES ('upload-a', 'gzip')");
    await pool.query("INSERT INTO scan_jobs (id, kind, projection_version) VALUES ('results', 'results', 1)");
    await expect(pool.query("INSERT INTO scan_jobs (id, kind, projection_version) VALUES ('none', 'scan', 1)")).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("INSERT INTO scan_jobs (id, kind, scan_id, projection_version) VALUES ('targeted', 'results', 'scan-a', 1)")).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("INSERT INTO scan_jobs (id, kind, upload_id, scan_id, projection_version) VALUES ('both', 'upload', 'upload-a', 'scan-a', 1)")).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("INSERT INTO scan_jobs (id, kind, projection_version) VALUES ('other', 'other', 1)")).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("INSERT INTO scan_artifact_chunks (upload_id, ordinal, bytes) VALUES ('upload-a', 0, $1)", [Buffer.alloc(1024 * 1024 + 1)])).rejects.toMatchObject({ code: "23514" });
  });
});

async function readJob(pool: Pool, id: string) {
  return (await pool.query("SELECT state, stage, attempts, lease_owner, lease_token, error_code, error_message FROM scan_jobs WHERE id = $1", [id])).rows[0];
}
async function readReceipt(pool: Pool, uploadId: string) {
  return (await pool.query("SELECT state, scan_id, error_code, error_message FROM scan_uploads WHERE upload_id = $1", [uploadId])).rows[0];
}
async function expireAndReclaimLease(pool: Pool, job: ClaimedScanJob): Promise<ClaimedScanJob> {
  await pool.query("UPDATE scan_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [job.id]);
  const reclaimed = await claimScanJob(pool, "reclaimer");
  expect(reclaimed).toMatchObject({ id: job.id, attempt: job.attempt + 1 });
  expect(reclaimed?.leaseToken).not.toBe(job.leaseToken);
  return reclaimed as ClaimedScanJob;
}
function publishUsingOldLease(pool: Pool, job: ClaimedScanJob) {
  return publishScan(pool, sampleArtifact(), { uploadedByUserId: null, sourceUploadId: job.uploadId as string, guard: { jobId: job.id, leaseToken: job.leaseToken } });
}
async function publishedScans(pool: Pool) {
  return (await pool.query("SELECT count(*)::int AS n FROM scans")).rows[0].n;
}

describe.skipIf(!databaseUrl)("scan job leases", { timeout: 30_000 }, () => {
  it("claims one queued job for concurrent claimers and marks its receipt processing", async () => {
    await withReadModelDatabase(async pool => {
      const uploadId = await receiveArtifact(pool, sampleArtifact());
      const claimed = await Promise.all([claimScanJob(pool, "a"), claimScanJob(pool, "b")]);
      expect(claimed.filter(Boolean)).toHaveLength(1);
      const job = claimed.find(Boolean) as ClaimedScanJob;
      expect(job).toMatchObject({ uploadId, scanId: null, projectionVersion: PROJECTION_VERSION, attempt: 1 });
      expect(await readJob(pool, job.id)).toMatchObject({ state: "processing", attempts: 1, lease_token: job.leaseToken });
      expect(await readReceipt(pool, uploadId)).toMatchObject({ state: "processing", scan_id: null });
      expect(await claimScanJob(pool, "c")).toBeNull();
    });
  });

  it("hands distinct jobs to parallel claimers", async () => {
    await withReadModelDatabase(async pool => {
      const ids = [await receiveArtifact(pool, sampleArtifact()), await receiveArtifact(pool, sampleArtifact()), await receiveArtifact(pool, sampleArtifact())];
      const claimed = await Promise.all([claimScanJob(pool, "a"), claimScanJob(pool, "b"), claimScanJob(pool, "c")]);
      expect(new Set(claimed.map(job => job?.uploadId))).toEqual(new Set(ids));
    });
  });

  it("claims by priority, then availability", async () => {
    await withReadModelDatabase(async pool => {
      const ids = [await receiveArtifact(pool, sampleArtifact()), await receiveArtifact(pool, sampleArtifact()), await receiveArtifact(pool, sampleArtifact())];
      await pool.query("UPDATE scan_jobs SET priority = priority + 1 WHERE upload_id = $1", [ids[2]]);
      await pool.query("UPDATE scan_jobs SET available_at = now() - interval '1 minute' WHERE upload_id = $1", [ids[1]]);
      const sequence = [];
      for (let index = 0; index < 3; index++) sequence.push((await claimScanJob(pool, "a"))?.uploadId);
      expect(sequence).toEqual([ids[2], ids[1], ids[0]]);
    });
  });

  it("skips jobs that are not yet available or belong to a newer projection version", async () => {
    await withReadModelDatabase(async pool => {
      const later = await receiveArtifact(pool, sampleArtifact());
      const newer = await receiveArtifact(pool, sampleArtifact());
      await pool.query("UPDATE scan_jobs SET available_at = now() + interval '1 hour' WHERE upload_id = $1", [later]);
      await pool.query("UPDATE scan_jobs SET projection_version = $2 WHERE upload_id = $1", [newer, PROJECTION_VERSION + 1]);
      expect(await claimScanJob(pool, "a")).toBeNull();
    });
  });

  it("reclaims an expired lease under a new token and fences the old publisher", async () => {
    await withReadModelDatabase(async pool => {
      const uploadId = await receiveArtifact(pool, sampleArtifact());
      const claimed = await Promise.all([claimScanJob(pool, "a"), claimScanJob(pool, "b")]);
      expect(claimed.filter(Boolean)).toHaveLength(1);
      const original = claimed.find(Boolean) as ClaimedScanJob;
      const reclaimed = await expireAndReclaimLease(pool, original);
      await expect(publishUsingOldLease(pool, original)).rejects.toThrow(/lease/i);
      expect(await publishedScans(pool)).toBe(0);
      expect(await readReceipt(pool, uploadId)).toMatchObject({ state: "processing", scan_id: null });
      expect(await readJob(pool, original.id)).toMatchObject({ state: "processing", attempts: 2, lease_owner: "reclaimer", lease_token: reclaimed.leaseToken });
      expect(await renewScanJob(pool, original)).toBe(false);
      expect(await renewScanJob(pool, reclaimed)).toBe(true);
    });
  });

  it("rejects a publisher whose lease is reclaimed by another client while its transaction is open", async () => {
    await withReadModelDatabase(async pool => {
      const uploadId = await receiveArtifact(pool, sampleArtifact());
      const original = await claimScanJob(pool, "a") as ClaimedScanJob;
      const other = new Pool({ connectionString: (pool.options as { connectionString: string }).connectionString, max: 1 });
      try {
        let reclaimed: ClaimedScanJob | undefined;
        const racing = new Proxy(pool, {
          get(target, key) {
            if (key !== "connect") {
              const value = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            }
            return async () => {
              const client = await target.connect();
              return new Proxy(client, {
                get(connection, property) {
                  if (property === "query") return async (query: string, values?: unknown[]) => {
                    if (!reclaimed && query.startsWith("INSERT INTO scan_repo_views")) reclaimed = await expireAndReclaimLease(other, original);
                    return connection.query(query, values);
                  };
                  const value = Reflect.get(connection, property);
                  return typeof value === "function" ? value.bind(connection) : value;
                },
              });
            };
          },
        });
        await expect(publishUsingOldLease(racing, original)).rejects.toThrow(/lease/i);
        expect(reclaimed).toBeDefined();
        expect(await publishedScans(pool)).toBe(0);
        expect((await pool.query("SELECT count(*)::int AS n FROM scan_repo_views")).rows[0].n).toBe(0);
        expect(await readReceipt(pool, uploadId)).toMatchObject({ state: "processing", scan_id: null });
        expect(await readJob(pool, original.id)).toMatchObject({ state: "processing", lease_token: reclaimed?.leaseToken });
      } finally { await other.end(); }
    });
  });

  it("rejects publication after the lease expires even when nobody reclaimed it", async () => {
    await withReadModelDatabase(async pool => {
      await receiveArtifact(pool, sampleArtifact());
      const job = await claimScanJob(pool, "a") as ClaimedScanJob;
      await pool.query("UPDATE scan_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [job.id]);
      await expect(publishUsingOldLease(pool, job)).rejects.toThrow(/lease/i);
      expect(await renewScanJob(pool, job)).toBe(false);
      expect(await publishedScans(pool)).toBe(0);
    });
  });

  it("rejects a publication whose lease expires while its transaction is open", async () => {
    await withReadModelDatabase(async pool => {
      await receiveArtifact(pool, sampleArtifact());
      const job = await claimScanJob(pool, "a") as ClaimedScanJob;
      let expired = false;
      const slow = new Proxy(pool, {
        get(target, key) {
          if (key !== "connect") {
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return async () => {
            const client = await target.connect();
            return new Proxy(client, {
              get(connection, property) {
                if (property === "query") return async (query: string, values?: unknown[]) => {
                  if (!expired && query.startsWith("INSERT INTO scan_repo_views")) {
                    expired = true;
                    await pool.query("UPDATE scan_jobs SET lease_expires_at = clock_timestamp() + interval '100 milliseconds' WHERE id = $1", [job.id]);
                    await vi.waitFor(async () => {
                      const { rows: [lease] } = await pool.query("SELECT lease_expires_at < clock_timestamp() AS expired FROM scan_jobs WHERE id = $1", [job.id]);
                      expect(lease.expired).toBe(true);
                    }, { timeout: 10_000 });
                  }
                  return connection.query(query, values);
                };
                const value = Reflect.get(connection, property);
                return typeof value === "function" ? value.bind(connection) : value;
              },
            });
          };
        },
      });
      await expect(publishUsingOldLease(slow, job)).rejects.toThrow(/lease/i);
      expect(expired).toBe(true);
      expect(await publishedScans(pool)).toBe(0);
    });
  });

  it("completes the receipt and job in the publication transaction", async () => {
    await withReadModelDatabase(async pool => {
      const uploadId = await receiveArtifact(pool, sampleArtifact());
      const job = await claimScanJob(pool, "a") as ClaimedScanJob;
      expect(await publishUsingOldLease(pool, job)).toMatchObject({ status: "inserted", scanId: "scan-a" });
      expect(await readJob(pool, job.id)).toEqual({ state: "ready", stage: "ready", attempts: 1, lease_owner: null, lease_token: null, error_code: null, error_message: null });
      expect(await readReceipt(pool, uploadId)).toEqual({ state: "ready", scan_id: "scan-a", error_code: null, error_message: null });
      expect(await renewScanJob(pool, job)).toBe(false);
    });
  });

  it("fails an expired job that exhausted its attempts instead of reclaiming it", async () => {
    await withReadModelDatabase(async pool => {
      const uploadId = await receiveArtifact(pool, sampleArtifact());
      const job = await claimScanJob(pool, "a") as ClaimedScanJob;
      await pool.query("UPDATE scan_jobs SET attempts = $2, lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [job.id, SCAN_JOB_MAX_ATTEMPTS]);
      expect(await claimScanJob(pool, "b")).toBeNull();
      expect(await readJob(pool, job.id)).toMatchObject({ state: "failed", lease_token: null, error_code: "attempts_exhausted" });
      expect(await readReceipt(pool, uploadId)).toMatchObject({
        state: "failed", scan_id: null, error_code: "attempts_exhausted",
        error_message: "Couldn't upload the scan: the dashboard couldn't finish processing it after several tries. Ask your dashboard administrator to check its logs.",
      });
    });
  });

  it("retries with backoff, fails permanently, and ignores settlement from a stale lease", async () => {
    await withReadModelDatabase(async pool => {
      const uploadId = await receiveArtifact(pool, sampleArtifact());
      const first = await claimScanJob(pool, "a") as ClaimedScanJob;
      await retryScanJob(pool, first, 60_000, { code: "processing_error", message: "Scan processing failed" });
      expect(await readJob(pool, first.id)).toMatchObject({ state: "queued", lease_token: null, error_code: "processing_error" });
      expect(await readReceipt(pool, uploadId)).toMatchObject({ state: "queued", error_code: null });
      expect(await claimScanJob(pool, "a")).toBeNull();
      await pool.query("UPDATE scan_jobs SET available_at = now() WHERE id = $1", [first.id]);
      const second = await claimScanJob(pool, "a") as ClaimedScanJob;
      await failScanJob(pool, first, { code: "invalid_json", message: "stale" });
      expect(await readJob(pool, first.id)).toMatchObject({ state: "processing", lease_token: second.leaseToken });
      await failScanJob(pool, second, { code: "invalid_json", message: "Scan artifact is not valid JSON" });
      expect(await readJob(pool, first.id)).toMatchObject({ state: "failed", stage: "failed", lease_token: null, error_code: "invalid_json", error_message: "Scan artifact is not valid JSON" });
      expect(await readReceipt(pool, uploadId)).toEqual({ state: "failed", scan_id: null, error_code: "invalid_json", error_message: "Scan artifact is not valid JSON" });
    });
  });
});
