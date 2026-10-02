import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueChartResults, PROJECTION_VERSION } from "@scoutui/web-shared";
import { rebuild } from "../../scripts/rebuild.mjs";
import { claimScanJob, enqueueScanJob, failScanJob, SCAN_JOB_PRIORITY } from "@/lib/scan-jobs";
import { publishScan } from "@/lib/scan-projection";
import { processScanJob, runScanJobs } from "@/worker/runner";
import { openReadModelDatabase } from "../helpers/read-model-db";
import { sampleArtifact } from "../helpers/scan-artifact";

// biome-ignore lint/complexity/useLiteralKeys: env access
const databaseUrl = process.env["DATABASE_URL"];

async function seed(pool: Pool, count: number): Promise<void> {
  for (let index = 1; index <= count; index++) {
    await publishScan(pool, sampleArtifact({ scanId: `a-${index}`, repoId: "a", scannedAt: `2026-09-0${index}T00:00:00Z` }), { uploadedByUserId: null });
  }
  await pool.query("DELETE FROM scan_jobs");
}

async function jobs(pool: Pool) {
  return (await pool.query("SELECT kind, scan_id, state, attempts, repair FROM scan_jobs ORDER BY kind, scan_id")).rows;
}

async function drain(pool: Pool): Promise<void> {
  for (let job = await claimScanJob(pool, "test"); job; job = await claimScanJob(pool, "test")) {
    await processScanJob(pool, job, new AbortController().signal);
  }
}

async function revisions(pool: Pool) {
  return (await pool.query("SELECT scan_id, build_revision FROM scan_read_models ORDER BY scan_id")).rows;
}

const quiet = { log: () => {} };

describe.skipIf(!databaseUrl)("rebuild command", { timeout: 30_000 }, () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  beforeAll(async () => { database = openReadModelDatabase(); pool = await database.pool; });
  beforeEach(async () => { await pool.query("TRUNCATE repos, scan_uploads, scan_jobs, chart_results CASCADE"); });
  afterAll(async () => { await database.close(); });

  it("enqueues missing scans and chart results once", async () => {
    await seed(pool, 3);
    await pool.query("DELETE FROM scan_read_models");
    expect(await rebuild(pool, quiet)).toEqual({ queued: 4, processing: 0, ready: 0, failed: 0, timedOut: false });
    const expected = [
      { kind: "results", scan_id: null, state: "queued", attempts: 0, repair: false },
      ...["a-1", "a-2", "a-3"].map(scanId => ({ kind: "scan", scan_id: scanId, state: "queued", attempts: 0, repair: false })),
    ];
    expect(await jobs(pool)).toEqual(expected);
    expect(await rebuild(pool, quiet)).toEqual({ queued: 4, processing: 0, ready: 0, failed: 0, timedOut: false });
    expect(await jobs(pool)).toEqual(expected);
  });

  it("limits the selection to the named scans", async () => {
    await seed(pool, 3);
    await pool.query("DELETE FROM scan_read_models WHERE scan_id IN ('a-1', 'a-2')");
    expect(await rebuild(pool, { ...quiet, scanIds: ["a-2", "a-3"] })).toMatchObject({ queued: 1, failed: 0 });
    expect(await jobs(pool)).toEqual([{ kind: "scan", scan_id: "a-2", state: "queued", attempts: 0, repair: false }]);
  });

  it("repairs ready current-version scans with a forced republication", async () => {
    await seed(pool, 2);
    const client = await pool.connect();
    try { await enqueueScanJob(client, "a-1", PROJECTION_VERSION, SCAN_JOB_PRIORITY.history); } finally { client.release(); }
    await drain(pool);
    expect(await jobs(pool)).toEqual([{ kind: "scan", scan_id: "a-1", state: "ready", attempts: 1, repair: false }]);
    expect(await revisions(pool)).toEqual([{ scan_id: "a-1", build_revision: 1 }, { scan_id: "a-2", build_revision: 1 }]);

    expect(await rebuild(pool, { ...quiet, repair: true })).toMatchObject({ queued: 3, failed: 0 });
    expect(await jobs(pool)).toEqual([
      { kind: "results", scan_id: null, state: "queued", attempts: 0, repair: false },
      { kind: "scan", scan_id: "a-1", state: "queued", attempts: 0, repair: true },
      { kind: "scan", scan_id: "a-2", state: "queued", attempts: 0, repair: true },
    ]);
    await drain(pool);
    expect(await revisions(pool)).toEqual([{ scan_id: "a-1", build_revision: 2 }, { scan_id: "a-2", build_revision: 2 }]);
  });

  it("requeues failed jobs only when asked", async () => {
    await seed(pool, 1);
    await pool.query("DELETE FROM scan_read_models");
    await rebuild(pool, { ...quiet, scanIds: ["a-1"] });
    await pool.query("UPDATE scan_jobs SET state = 'failed', attempts = 5, error_code = 'processing_error', error_message = 'Scan processing failed'");
    expect(await rebuild(pool, { ...quiet, scanIds: ["a-1"] })).toMatchObject({ queued: 0, failed: 1 });
    expect(await rebuild(pool, { ...quiet, scanIds: ["a-1"], retryFailed: true })).toMatchObject({ queued: 1, failed: 0 });
    expect((await pool.query("SELECT state, attempts, error_code FROM scan_jobs")).rows).toEqual([{ state: "queued", attempts: 0, error_code: null }]);
  });

  it("waits for a running worker and reports the settled selection", async () => {
    await seed(pool, 3);
    await pool.query("DELETE FROM scan_read_models");
    const stop = new AbortController();
    const worker = runScanJobs(pool, { owner: "worker", signal: stop.signal, idleMs: 10 });
    const lines: string[] = [];
    try {
      const result = await rebuild(pool, { wait: true, pollMs: 20, timeoutMs: 20_000, log: line => lines.push(line) });
      expect(result).toEqual({ queued: 0, processing: 0, ready: 3, failed: 0, timedOut: false });
    } finally {
      stop.abort();
      await worker;
    }
    expect(lines.at(-1)).toBe("queued 0, processing 0, ready 3, failed 0");
    expect((await pool.query("SELECT count(*)::int AS n FROM chart_results")).rows[0].n).toBeGreaterThan(0);
  });

  it("settles on the named scans alone, ignoring chart results jobs", async () => {
    await seed(pool, 1);
    await enqueueChartResults(pool);
    const results = await claimScanJob(pool, "test");
    if (results?.kind !== "results") throw new Error("Expected the results job");
    await failScanJob(pool, results, { code: "results_failed", message: "Results failed" });
    await pool.query("DELETE FROM scan_read_models");
    const lines: string[] = [];
    const waiting = rebuild(pool, { scanIds: ["a-1"], wait: true, pollMs: 20, timeoutMs: 5_000, log: line => lines.push(line) });
    let job = await claimScanJob(pool, "test");
    while (!job) {
      await new Promise(resolve => setTimeout(resolve, 10));
      job = await claimScanJob(pool, "test");
    }
    expect(job.scanId).toBe("a-1");
    await processScanJob(pool, job, new AbortController().signal);
    expect(await waiting).toEqual({ queued: 0, processing: 0, ready: 1, failed: 0, timedOut: false });
    expect(lines.filter(line => line.startsWith("failed "))).toEqual([]);
    expect(await jobs(pool)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "results", state: "failed" })]));
  });

  it("times out and names the missing worker when nothing is claimed", async () => {
    await seed(pool, 1);
    await pool.query("DELETE FROM scan_read_models");
    const lines: string[] = [];
    const result = await rebuild(pool, { wait: true, pollMs: 50, timeoutMs: 300, log: line => lines.push(line) });
    expect(result).toEqual({ queued: 2, processing: 0, ready: 0, failed: 0, timedOut: true });
    expect(lines).toContain("No worker has claimed a job; is the worker running?");
  });
});
