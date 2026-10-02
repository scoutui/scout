import { randomBytes } from "node:crypto";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostgresDriver, PROJECTION_VERSION } from "@scoutui/web-shared";
import { claimScanJob, enqueueScanJob, getUploadStatus, SCAN_JOB_MAX_ATTEMPTS, SCAN_JOB_PRIORITY, ScanJobLeaseError, type ClaimedScanJob } from "@/lib/scan-jobs";
import { publishScan } from "@/lib/scan-projection";
import { reconcileScanJobs } from "@/lib/scan-reconciliation";
import { processScanJob, runScanJobs, SCAN_JOB_RENEW_MS } from "@/worker/runner";
import { withReadModelDatabase } from "../helpers/read-model-db";
import { receiveArtifact, sampleArtifact } from "../helpers/scan-artifact";

type QueryHook = (query: string, values?: unknown[]) => Promise<void> | void;

function interceptQueries(pool: Pool, hook: QueryHook): Pool {
  const wrap = <T extends object>(target: T, wrapQuery: boolean): T => new Proxy(target, {
    get(object, key) {
      if (key === "query" && wrapQuery) {
        return async (query: string, values?: unknown[]) => {
          await hook(query, values);
          return (object as unknown as Pool).query(query, values);
        };
      }
      if (key === "connect" && object === pool) return async () => wrap(await pool.connect(), true);
      const value = Reflect.get(object, key);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
  return wrap(pool, true);
}

async function jobOf(pool: Pool, uploadId: string) {
  return (await pool.query("SELECT state, stage, attempts, lease_token, error_code, error_message, available_at <= now() AS available FROM scan_jobs WHERE upload_id = $1", [uploadId])).rows[0];
}
async function receiptOf(pool: Pool, uploadId: string) {
  return (await pool.query("SELECT state, scan_id, error_code, error_message FROM scan_uploads WHERE upload_id = $1", [uploadId])).rows[0];
}
async function scanCount(pool: Pool) {
  return (await pool.query("SELECT count(*)::int AS n FROM scans")).rows[0].n;
}
async function claim(pool: Pool) {
  return await claimScanJob(pool, "worker-test") as ClaimedScanJob;
}
async function receiveAndProcess(pool: Pool, value: unknown, options: { rescan?: boolean } = {}) {
  const uploadId = await receiveArtifact(pool, value, options);
  await processScanJob(pool, await claim(pool), new AbortController().signal);
  return uploadId;
}
function flip(bytes: Buffer, fromEnd: number) {
  const index = bytes.length - fromEnd;
  bytes.writeUInt8(bytes.readUInt8(index) ^ 0xff, index);
  return bytes;
}

setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc") as () => void;

const { DATABASE_URL: databaseUrl } = process.env;

describe.skipIf(!databaseUrl)("scan job processing", { timeout: 30_000 }, () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each<[string, unknown, string, string]>([
    ["a non-numeric schema version as an invalid artifact", "two", "invalid_artifact", "Couldn't upload the scan: the dashboard can't read it. Ask your dashboard administrator to upgrade it, or report a bug."],
    ["an older schema version with CLI upgrade guidance", 1, "unsupported_version", "Couldn't upload the scan: this CLI is too old for the dashboard. Upgrade the CLI and try again."],
    ["a newer schema version with dashboard upgrade guidance", 3, "unsupported_version", "Couldn't upload the scan: this CLI is newer than the dashboard. Ask your dashboard administrator to upgrade it."],
  ])("rejects %s before creating a scan", async (_, schemaVersion, code, message) => {
    await withReadModelDatabase(async pool => {
      const value = sampleArtifact();
      const uploadId = await receiveAndProcess(pool, { ...value, meta: { ...value.meta, schemaVersion } });
      expect(await receiptOf(pool, uploadId)).toMatchObject({ state: "failed", error_code: code, error_message: message });
      expect(await scanCount(pool)).toBe(0);
    });
  });

  it("rejects a component whose ID disagrees with its identity and logs the failing path", async () => {
    await withReadModelDatabase(async pool => {
      const logs: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
      const value = sampleArtifact();
      const component = value.components[0] ?? expect.unreachable();
      component.id = "not-the-component-key";
      const uploadId = await receiveAndProcess(pool, value);
      expect(await receiptOf(pool, uploadId)).toMatchObject({
        state: "failed", error_code: "invalid_artifact",
        error_message: "Couldn't upload the scan: the dashboard can't read it. Ask your dashboard administrator to upgrade it, or report a bug.",
      });
      expect(logs.at(-1)).toMatch(/^\[worker\] job \S+ attempt 1 failed invalid_artifact at components\[0\]\.id$/);
      expect(await scanCount(pool)).toBe(0);
    });
  });

  it("publishes a queued upload and completes its receipt with sanitized stage logs", async () => {
    await withReadModelDatabase(async pool => {
      const logs: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
      const uploadId = await receiveArtifact(pool, sampleArtifact());
      const job = await claim(pool);
      await processScanJob(pool, job, new AbortController().signal);
      expect(await receiptOf(pool, uploadId)).toEqual({ state: "ready", scan_id: "scan-a", error_code: null, error_message: null });
      expect(await jobOf(pool, uploadId)).toMatchObject({ state: "ready", stage: "ready", attempts: 1, lease_token: null });
      expect((await pool.query("SELECT artifact, source_upload_id FROM scans")).rows).toEqual([{ artifact: null, source_upload_id: uploadId }]);
      expect((await pool.query("SELECT state, projection_version FROM scan_read_models")).rows).toEqual([{ state: "ready", projection_version: PROJECTION_VERSION }]);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.every(line => line.startsWith(`[worker] job ${job.id}`))).toBe(true);
      expect(logs.join("\n")).not.toMatch(/@sample|Button|repo-a|scan-a/);
      expect(logs.join("\n")).not.toContain(job.leaseToken);
    });
  });

  it("logs a results job's outcome with its elapsed time", async () => {
    await withReadModelDatabase(async pool => {
      const logs: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
      await publishScan(pool, sampleArtifact(), { uploadedByUserId: null });
      const job = await claim(pool);
      expect(job.kind).toBe("results");
      await processScanJob(pool, job, new AbortController().signal);
      expect(logs.at(-1)).toMatch(new RegExp(`^\\[worker\\] job ${job.id} attempt 1 ready results written in \\d+ms$`));
    });
  });

  it.each<[string, () => Buffer, string]>([
    ["bytes that are not gzip", () => randomBytes(512), "invalid_gzip"],
    ["a corrupt gzip trailer", () => flip(gzipSync(JSON.stringify(sampleArtifact())), 6), "invalid_gzip"],
    ["invalid JSON", () => gzipSync("{\"meta\":"), "invalid_json"],
    ["an unsupported artifact shape", () => gzipSync(JSON.stringify({ ...sampleArtifact(), components: {} })), "invalid_artifact"],
    ["output past the configured decoded cap", () => gzipSync(Buffer.alloc(1025, 0x20)), "decoded_limit"],
  ])("fails %s permanently with a stable code", async (_, bytes, code) => {
    vi.stubEnv("SCOUTUI_MAX_DECODED_ARTIFACT_BYTES", "1024");
    await withReadModelDatabase(async pool => {
      const uploadId = await receiveAndProcess(pool, bytes());
      const receipt = await receiptOf(pool, uploadId);
      expect(receipt).toMatchObject({ state: "failed", scan_id: null, error_code: code });
      expect(receipt.error_message).toMatch(/^Couldn't upload the scan: /);
      expect(await jobOf(pool, uploadId)).toMatchObject({ state: "failed", stage: "failed", attempts: 1, lease_token: null, error_code: code });
      expect(await scanCount(pool)).toBe(0);
      expect(await claimScanJob(pool, "again")).toBeNull();
    });
  });

  it("fails a reused scan ID from a different repository without touching the canonical scan", async () => {
    await withReadModelDatabase(async pool => {
      const first = await receiveAndProcess(pool, sampleArtifact());
      const before = (await pool.query("SELECT * FROM scans")).rows;
      const second = await receiveAndProcess(pool, sampleArtifact({ repoId: "other-repo" }));
      expect(await receiptOf(pool, second)).toEqual({ state: "failed", scan_id: null, error_code: "identity_conflict", error_message: "Couldn't upload the scan: the dashboard already has a different scan with the same ID. Scan again to get a new ID." });
      expect(await receiptOf(pool, first)).toMatchObject({ state: "ready", scan_id: "scan-a" });
      expect((await pool.query("SELECT * FROM scans")).rows).toEqual(before);
    });
  });

  it("links a duplicate upload to a readable canonical scan", async () => {
    await withReadModelDatabase(async pool => {
      const canonical = sampleArtifact();
      canonical.meta.repo.branchPosition = 7;
      const first = await receiveAndProcess(pool, canonical);
      const second = await receiveAndProcess(pool, { ...sampleArtifact({ scannedAt: "2026-09-25T00:00:00Z" }), components: [], occurrences: [], relationships: [] });
      expect(await receiptOf(pool, second)).toEqual({ state: "duplicate", scan_id: "scan-a", error_code: null, error_message: null });
      expect((await pool.query("SELECT source_upload_id, committed_at, branch_position FROM scans")).rows)
        .toEqual([{ source_upload_id: first, committed_at: new Date("2026-09-19T00:00:00Z"), branch_position: 7 }]);
      expect((await pool.query("SELECT build_revision FROM scan_read_models")).rows).toEqual([{ build_revision: 1 }]);
      expect((await pool.query("SELECT count(*)::int AS n FROM scan_component_facts")).rows[0].n).toBe(1);
    });
  });

  it("skips a plain upload of a stored commit, pointing its receipt at the stored scan and dropping its archive", async () => {
    await withReadModelDatabase(async pool => {
      const first = await receiveAndProcess(pool, sampleArtifact({ scanId: "scan-a", commit: "abc" }));
      const again = await receiveAndProcess(pool, sampleArtifact({ scanId: "scan-b", commit: "abc" }));
      expect(await receiptOf(pool, again)).toEqual({ state: "duplicate", scan_id: "scan-a", error_code: null, error_message: null });
      expect(await getUploadStatus(pool, again)).toEqual({ state: "duplicate", readable: true, scanId: "scan-a", url: "/repos/repo-a" });
      expect((await pool.query("SELECT scan_id, source_upload_id FROM scans")).rows).toEqual([{ scan_id: "scan-a", source_upload_id: first }]);
      expect((await pool.query("SELECT DISTINCT upload_id FROM scan_artifact_chunks")).rows).toEqual([{ upload_id: first }]);
    });
  });

  it("replaces a rescanned commit's scan and deletes the replaced scan's uploads and their archives", async () => {
    await withReadModelDatabase(async pool => {
      await receiveAndProcess(pool, sampleArtifact({ scanId: "scan-a", commit: "abc" }));
      await receiveAndProcess(pool, sampleArtifact({ scanId: "scan-a", commit: "abc" }));
      await receiveAndProcess(pool, sampleArtifact({ scanId: "scan-c", commit: "abc" }));
      const rescan = await receiveAndProcess(pool, sampleArtifact({ scanId: "scan-b", commit: "abc" }), { rescan: true });
      expect((await pool.query("SELECT scan_id, source_upload_id FROM scans")).rows).toEqual([{ scan_id: "scan-b", source_upload_id: rescan }]);
      expect((await pool.query("SELECT upload_id, state, scan_id FROM scan_uploads")).rows).toEqual([{ upload_id: rescan, state: "ready", scan_id: "scan-b" }]);
      expect((await pool.query("SELECT DISTINCT upload_id FROM scan_artifact_chunks")).rows).toEqual([{ upload_id: rescan }]);
      expect(await getUploadStatus(pool, rescan)).toMatchObject({ state: "ready", scanId: "scan-b", replaced: true });
    });
  });

  it("stores an uploaded scan's branch position, and moves an old scan to its commit date and position when the worker republishes it, keeping the stored branch and arrival time", async () => {
    await withReadModelDatabase(async pool => {
      const scan = sampleArtifact({ scannedAt: "2026-09-19T00:00:00.000Z", commit: "abc" });
      scan.meta.repo.committedAt = "2026-09-01T00:00:00.000Z";
      scan.meta.repo.branchPosition = 42;
      await receiveAndProcess(pool, scan);
      expect((await pool.query("SELECT branch_position FROM scans")).rows).toEqual([{ branch_position: 42 }]);
      await pool.query("UPDATE scans SET committed_at = $1, branch_position = NULL, branch = 'main', created_at = '2026-09-19T00:05:00Z'", [scan.meta.scannedAt]);
      await pool.query("UPDATE scan_read_models SET projection_version = $1", [PROJECTION_VERSION - 1]);
      await reconcileScanJobs(pool, 10);
      for (let job = await claimScanJob(pool, "worker-test"); job; job = await claimScanJob(pool, "worker-test")) {
        await processScanJob(pool, job, new AbortController().signal);
      }
      expect(await new PostgresDriver(pool).listScans("repo-a")).toEqual([{ scanId: "scan-a", committedAt: "2026-09-01T00:00:00.000Z", arrivedAt: "2026-09-19T00:05:00.000Z", commit: "abc", branch: "main", uploadedBy: null, ready: true }]);
      expect((await pool.query("SELECT branch_position FROM scans")).rows).toEqual([{ branch_position: 42 }]);
    });
  });

  it("rebuilds unavailable canonical models before reporting a duplicate, keeping the stored scan's date and branch position", async () => {
    await withReadModelDatabase(async pool => {
      const canonical = sampleArtifact();
      canonical.meta.repo.branchPosition = 7;
      await receiveAndProcess(pool, canonical);
      await pool.query("DELETE FROM scan_read_models");
      await pool.query("DELETE FROM scan_component_facts");
      const duplicate = sampleArtifact({ scannedAt: "2026-09-25T00:00:00Z" });
      duplicate.meta.repo.branchPosition = 9;
      const uploadId = await receiveArtifact(pool, duplicate);
      const job = await claim(pool);
      let gate: () => void = () => {};
      const opened = new Promise<void>(resolve => { gate = resolve; });
      let reachedRebuild = false;
      const gated = interceptQueries(pool, async query => {
        if (query.startsWith("INSERT INTO scan_repo_views") && !reachedRebuild) {
          reachedRebuild = true;
          await opened;
        }
      });
      const processing = processScanJob(gated, job, new AbortController().signal);
      await vi.waitFor(() => expect(reachedRebuild).toBe(true), { timeout: 10_000 });
      expect(await receiptOf(pool, uploadId)).toMatchObject({ state: "processing", scan_id: null });
      gate();
      await processing;
      expect(await receiptOf(pool, uploadId)).toMatchObject({ state: "duplicate", scan_id: "scan-a" });
      expect((await pool.query("SELECT state, projection_version, build_revision FROM scan_read_models")).rows).toEqual([{ state: "ready", projection_version: PROJECTION_VERSION, build_revision: 1 }]);
      expect((await pool.query("SELECT count(*)::int AS n FROM scan_component_facts")).rows[0].n).toBe(1);
      expect((await pool.query("SELECT committed_at, branch_position FROM scans")).rows).toEqual([{ committed_at: new Date("2026-09-19T00:00:00Z"), branch_position: 7 }]);
    });
  });

  it("releases the upload's parsed artifact before decoding a stale canonical archive", async () => {
    await withReadModelDatabase(async pool => {
      const canonicalUpload = await receiveAndProcess(pool, sampleArtifact());
      await pool.query("DELETE FROM scan_read_models");
      await receiveArtifact(pool, sampleArtifact());
      const job = await claim(pool);
      const parse = JSON.parse;
      const upload: { components?: WeakRef<object>; occurrences?: WeakRef<object> } = {};
      JSON.parse = (text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) => {
        const value = parse.call(JSON, text, reviver);
        if (!upload.components && Array.isArray(value?.components)) {
          upload.components = new WeakRef(value.components);
          upload.occurrences = new WeakRef(value.occurrences);
        }
        return value;
      };
      let reachableAtCanonicalDecode: boolean[] | undefined;
      const observed = interceptQueries(pool, (query, values) => {
        if (!reachableAtCanonicalDecode && query.startsWith("SELECT ordinal, bytes FROM scan_artifact_chunks") && values?.[0] === canonicalUpload) {
          collectGarbage();
          reachableAtCanonicalDecode = [upload.components?.deref() !== undefined, upload.occurrences?.deref() !== undefined];
        }
      });
      try {
        await processScanJob(observed, job, new AbortController().signal);
      } finally {
        JSON.parse = parse;
      }
      expect(upload.components).toBeDefined();
      expect(reachableAtCanonicalDecode).toEqual([false, false]);
      expect((await pool.query("SELECT state FROM scan_uploads WHERE upload_id <> $1", [canonicalUpload])).rows).toEqual([{ state: "duplicate" }]);
    });
  });

  it("recovers a publication that crashed before commit by reclaiming and reading the stored archive", async () => {
    await withReadModelDatabase(async pool => {
      const uploadId = await receiveArtifact(pool, sampleArtifact());
      const job = await claim(pool);
      const crashing = interceptQueries(pool, query => {
        if (query.startsWith("INSERT INTO scan_repo_views")) throw new Error("process terminated");
      });
      await expect(publishScan(crashing, sampleArtifact(), { uploadedByUserId: null, sourceUploadId: uploadId, guard: { jobId: job.id, leaseToken: job.leaseToken } })).rejects.toThrow("process terminated");
      expect(await scanCount(pool)).toBe(0);
      expect(await receiptOf(pool, uploadId)).toMatchObject({ state: "processing", scan_id: null });
      expect(await claimScanJob(pool, "other")).toBeNull();
      await pool.query("UPDATE scan_jobs SET lease_expires_at = clock_timestamp() - interval '1 second'");
      const retry = await claim(pool);
      expect(retry).toMatchObject({ id: job.id, attempt: 2 });
      await processScanJob(pool, retry, new AbortController().signal);
      expect(await receiptOf(pool, uploadId)).toMatchObject({ state: "ready", scan_id: "scan-a" });
      expect(await jobOf(pool, uploadId)).toMatchObject({ state: "ready", attempts: 2 });
    });
  });

  it("retries transient failures with increasing backoff and fails after the attempt limit", async () => {
    await withReadModelDatabase(async pool => {
      const uploadId = await receiveArtifact(pool, sampleArtifact());
      const failing = interceptQueries(pool, query => {
        if (query.startsWith("INSERT INTO scan_repo_views")) throw Object.assign(new Error("INSERT INTO scan_repo_views VALUES ('secret')"), { code: "57014" });
      });
      const delays: number[] = [];
      for (let attempt = 1; attempt <= SCAN_JOB_MAX_ATTEMPTS; attempt++) {
        await pool.query("UPDATE scan_jobs SET available_at = now()");
        const job = await claim(pool);
        expect(job.attempt).toBe(attempt);
        await processScanJob(failing, job, new AbortController().signal);
        const row = (await pool.query("SELECT state, error_code, error_message, extract(epoch FROM available_at - now()) AS delay FROM scan_jobs")).rows[0];
        if (attempt < SCAN_JOB_MAX_ATTEMPTS) {
          expect(row).toMatchObject({ state: "queued", error_code: "processing_failed" });
          expect(await receiptOf(pool, uploadId)).toMatchObject({ state: "queued", error_code: null });
          delays.push(Number(row.delay));
        }
      }
      expect(delays.every((delay, index) => delay > 0 && (index === 0 || delay > (delays[index - 1] ?? 0)))).toBe(true);
      const receipt = await receiptOf(pool, uploadId);
      expect(receipt).toEqual({ state: "failed", scan_id: null, error_code: "processing_failed", error_message: "Couldn't upload the scan: the dashboard hit an error while processing it. Try again, or ask your dashboard administrator to check its logs." });
      expect(await jobOf(pool, uploadId)).toMatchObject({ state: "failed", error_code: "processing_failed", error_message: "Couldn't upload the scan: the dashboard hit an error while processing it. Try again, or ask your dashboard administrator to check its logs." });
      expect(await scanCount(pool)).toBe(0);
    });
  });

  it("aborts publication when the heartbeat finds the lease reclaimed", async () => {
    await withReadModelDatabase(async pool => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const uploadId = await receiveArtifact(pool, sampleArtifact());
      const job = await claim(pool);
      const queries: string[] = [];
      let gate: () => void = () => {};
      const opened = new Promise<void>(resolve => { gate = resolve; });
      let reached = false;
      const gated = interceptQueries(pool, async query => {
        queries.push(query);
        if (query.startsWith("INSERT INTO scan_repo_views") && !reached) {
          reached = true;
          await opened;
        }
      });
      const processing = processScanJob(gated, job, new AbortController().signal);
      await vi.waitFor(() => expect(reached).toBe(true), { timeout: 10_000 });
      await pool.query("UPDATE scan_jobs SET lease_expires_at = clock_timestamp() - interval '1 second'");
      const reclaimed = await claim(pool);
      const abort = vi.spyOn(AbortController.prototype, "abort");
      vi.advanceTimersByTime(SCAN_JOB_RENEW_MS);
      await vi.waitFor(() => expect(abort).toHaveBeenCalledWith(expect.any(ScanJobLeaseError)), { timeout: 10_000 });
      gate();
      await processing;
      expect(queries.some(query => query.includes("FROM scan_jobs WHERE id = $1 FOR UPDATE"))).toBe(false);
      expect(await scanCount(pool)).toBe(0);
      expect(await receiptOf(pool, uploadId)).toMatchObject({ state: "processing", scan_id: null });
      expect(await jobOf(pool, uploadId)).toMatchObject({ state: "processing", lease_token: reclaimed.leaseToken, error_code: null });
    });
  });

  it("rolls back and releases the job immediately when shutdown interrupts publication", async () => {
    await withReadModelDatabase(async pool => {
      const uploadId = await receiveArtifact(pool, sampleArtifact());
      const job = await claim(pool);
      const shutdown = new AbortController();
      const gated = interceptQueries(pool, query => {
        if (query.startsWith("INSERT INTO scan_repo_views")) shutdown.abort();
      });
      await processScanJob(gated, job, shutdown.signal);
      expect(await scanCount(pool)).toBe(0);
      expect(await jobOf(pool, uploadId)).toMatchObject({ state: "queued", lease_token: null, error_code: null, available: true });
      expect(await receiptOf(pool, uploadId)).toMatchObject({ state: "queued", scan_id: null, error_code: null });
    });
  });

  it("republishes a scan-target job from the canonical archive", async () => {
    await withReadModelDatabase(async pool => {
      await receiveAndProcess(pool, sampleArtifact());
      await pool.query("UPDATE scan_read_models SET projection_version = 0");
      const client = await pool.connect();
      try { await enqueueScanJob(client, "scan-a", PROJECTION_VERSION, SCAN_JOB_PRIORITY.latest); } finally { client.release(); }
      const job = await claim(pool);
      expect(job).toMatchObject({ scanId: "scan-a", uploadId: null });
      await processScanJob(pool, job, new AbortController().signal);
      expect((await pool.query("SELECT state FROM scan_jobs WHERE scan_id = 'scan-a'")).rows).toEqual([{ state: "ready" }]);
      expect((await pool.query("SELECT projection_version, build_revision FROM scan_read_models")).rows).toEqual([{ projection_version: PROJECTION_VERSION, build_revision: 2 }]);
    });
  });

  it("processes queued jobs one at a time and stops claiming once stopped", async () => {
    await withReadModelDatabase(async pool => {
      const uploads = [await receiveArtifact(pool, sampleArtifact({ scanId: "scan-a" })), await receiveArtifact(pool, sampleArtifact({ scanId: "scan-b" }))];
      const stop = new AbortController();
      const running = runScanJobs(pool, { owner: "loop", signal: stop.signal, idleMs: 10 });
      await vi.waitFor(async () => {
        for (const uploadId of uploads) expect((await receiptOf(pool, uploadId)).state).toBe("ready");
      }, { timeout: 10_000 });
      stop.abort();
      await running;
      const late = await receiveArtifact(pool, sampleArtifact({ scanId: "scan-c" }));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(await receiptOf(pool, late)).toMatchObject({ state: "queued" });
    });
  });
});
