import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CHART_RESULTS_VERSION, enqueueChartResults, PostgresDriver, PROJECTION_VERSION, READ_MODEL_FORMAT_VERSION } from "@scoutui/web-shared";
import { processChartResultsJob } from "@/lib/chart-results-job";
import { claimScanJob, enqueueScanJob, SCAN_JOB_PRIORITY, type ClaimedScanJob } from "@/lib/scan-jobs";
import { publishScan } from "@/lib/scan-projection";
import { reconcileChartResults, reconcileScanJobs } from "@/lib/scan-reconciliation";
import { openReadModelDatabase } from "../helpers/read-model-db";
import { receiveArtifact, sampleArtifact } from "../helpers/scan-artifact";

const formatBump = vi.hoisted(() => ({ offset: 0 }));

// Two versions ahead of web-shared, so the outdated version below is positive and differs from web-shared's own.
// The format version follows web-shared's own unless a test raises `formatBump.offset`.
vi.mock("@scoutui/web-shared", async importOriginal => {
  const actual = await importOriginal<typeof import("@scoutui/web-shared")>();
  return {
    ...actual,
    PROJECTION_VERSION: actual.PROJECTION_VERSION + 2,
    get READ_MODEL_FORMAT_VERSION() { return actual.READ_MODEL_FORMAT_VERSION + formatBump.offset; },
  };
});

// biome-ignore lint/complexity/useLiteralKeys: env access
const databaseUrl = process.env["DATABASE_URL"];

async function seed(pool: Pool, repoId: string, count: number): Promise<void> {
  for (let index = 1; index <= count; index++) {
    await publishScan(pool, sampleArtifact({ scanId: `${repoId}-${index}`, repoId, scannedAt: `2026-09-0${index}T00:00:00Z` }), { uploadedByUserId: null });
  }
}

async function claimOrder(pool: Pool): Promise<string[]> {
  const order: string[] = [];
  for (let job = await claimScanJob(pool, "test"); job; job = await claimScanJob(pool, "test")) {
    await pool.query("UPDATE scan_jobs SET state = 'ready' WHERE id = $1", [job.id]);
    order.push(job.scanId ?? job.kind);
  }
  return order;
}

async function queuedScans(pool: Pool) {
  return (await pool.query("SELECT scan_id, priority FROM scan_jobs WHERE scan_id IS NOT NULL ORDER BY scan_id")).rows;
}

describe.skipIf(!databaseUrl)("scan read model reconciliation", { timeout: 30_000 }, () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  beforeAll(async () => { database = openReadModelDatabase(); pool = await database.pool; });
  beforeEach(async () => {
    formatBump.offset = 0;
    await pool.query("TRUNCATE repos, scan_uploads, scan_jobs, chart_results CASCADE");
  });
  afterAll(async () => { await database.close(); });

  async function readyJob(scanId: string): Promise<void> {
    const client = await pool.connect();
    try { await enqueueScanJob(client, scanId, PROJECTION_VERSION, SCAN_JOB_PRIORITY.history); } finally { client.release(); }
    await pool.query("UPDATE scan_jobs SET state = 'ready', stage = 'ready', attempts = 3 WHERE scan_id = $1", [scanId]);
  }

  async function scanJobs() {
    return (await pool.query("SELECT scan_id, state, attempts, priority, repair FROM scan_jobs WHERE scan_id IS NOT NULL ORDER BY scan_id")).rows;
  }

  it("does nothing on an empty database", async () => {
    expect(await reconcileScanJobs(pool, 4)).toEqual({ inspected: 0, enqueued: 0, hasMore: false });
  });

  it("enqueues missing models once, each repo's latest scan first, then history newest first", async () => {
    await seed(pool, "a", 3);
    await seed(pool, "b", 3);
    await pool.query("DELETE FROM scan_read_models");
    expect(await reconcileScanJobs(pool, 4)).toEqual({ inspected: 4, enqueued: 4, hasMore: true });
    expect(await reconcileScanJobs(pool, 4)).toEqual({ inspected: 2, enqueued: 2, hasMore: false });
    expect(await reconcileScanJobs(pool, 4)).toEqual({ inspected: 0, enqueued: 0, hasMore: false });
    const { rows } = await pool.query("SELECT scan_id, count(*)::int AS n FROM scan_jobs WHERE scan_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1");
    expect(rows).toEqual([]);
    expect(await queuedScans(pool)).toEqual([
      { scan_id: "a-1", priority: SCAN_JOB_PRIORITY.history }, { scan_id: "a-2", priority: SCAN_JOB_PRIORITY.history },
      { scan_id: "a-3", priority: SCAN_JOB_PRIORITY.latest }, { scan_id: "b-1", priority: SCAN_JOB_PRIORITY.history },
      { scan_id: "b-2", priority: SCAN_JOB_PRIORITY.history }, { scan_id: "b-3", priority: SCAN_JOB_PRIORITY.latest },
    ]);
    expect(await claimOrder(pool)).toEqual(["b-3", "a-3", "b-2", "a-2", "b-1", "a-1", "results"]);
  });

  it("claims a later latest scan before earlier queued history", async () => {
    await seed(pool, "a", 2);
    await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'a-1'");
    await reconcileScanJobs(pool, 4);
    await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'a-2'");
    await reconcileScanJobs(pool, 4);
    expect(await claimOrder(pool)).toEqual(["a-2", "a-1", "results"]);
  });

  it("claims an upload before any reconciliation job", async () => {
    await seed(pool, "a", 2);
    await pool.query("DELETE FROM scan_read_models");
    await reconcileScanJobs(pool, 4);
    await receiveArtifact(pool, sampleArtifact({ scanId: "uploaded", repoId: "c" }));
    expect(await claimOrder(pool)).toEqual(["upload", "a-2", "a-1", "results"]);
  });

  it("leaves ready current models alone, including empty scans and history without details", async () => {
    await seed(pool, "a", 2);
    await publishScan(pool, { ...sampleArtifact({ scanId: "empty", repoId: "e" }), components: [], occurrences: [] }, { uploadedByUserId: null });
    const { rows } = await pool.query("SELECT scan_id, state, details_retained FROM scan_read_models ORDER BY scan_id");
    expect(rows).toEqual([
      { scan_id: "a-1", state: "ready", details_retained: false }, { scan_id: "a-2", state: "ready", details_retained: true },
      { scan_id: "empty", state: "ready", details_retained: true },
    ]);
    expect(await reconcileScanJobs(pool, 4)).toEqual({ inspected: 0, enqueued: 0, hasMore: false });
  });

  it("leaves a model built in a newer format alone", async () => {
    await seed(pool, "a", 1);
    await pool.query("UPDATE scan_read_models SET format_version = $1", [READ_MODEL_FORMAT_VERSION + 1]);
    expect(await reconcileScanJobs(pool, 4)).toEqual({ inspected: 0, enqueued: 0, hasMore: false });
  });

  it("enqueues a repo's latest scan when its details were not retained", async () => {
    await seed(pool, "a", 2);
    await pool.query("UPDATE scan_read_models SET details_retained = false WHERE scan_id = 'a-2'");
    expect(await reconcileScanJobs(pool, 4)).toEqual({ inspected: 1, enqueued: 1, hasMore: false });
    expect(await queuedScans(pool)).toEqual([{ scan_id: "a-2", priority: SCAN_JOB_PRIORITY.latest }]);
  });

  it("requeues the ready current-version job of a scan built in an older format", async () => {
    await seed(pool, "a", 1);
    await readyJob("a-1");
    formatBump.offset = 1;
    expect((await pool.query("SELECT format_version FROM scan_read_models")).rows).toEqual([{ format_version: READ_MODEL_FORMAT_VERSION - 1 }]);
    expect(await reconcileScanJobs(pool, 4)).toEqual({ inspected: 1, enqueued: 1, hasMore: false });
    expect(await scanJobs()).toEqual([{ scan_id: "a-1", state: "queued", attempts: 0, priority: SCAN_JOB_PRIORITY.latest, repair: false }]);
  });

  it("requeues the ready current-version job of a latest scan without retained details", async () => {
    await seed(pool, "a", 2);
    await readyJob("a-2");
    await pool.query("UPDATE scan_read_models SET details_retained = false WHERE scan_id = 'a-2'");
    expect(await reconcileScanJobs(pool, 4)).toEqual({ inspected: 1, enqueued: 1, hasMore: false });
    expect(await scanJobs()).toEqual([{ scan_id: "a-2", state: "queued", attempts: 0, priority: SCAN_JOB_PRIORITY.latest, repair: false }]);
  });

  it("leaves the ready current-version job of a current scan alone", async () => {
    await seed(pool, "a", 1);
    await readyJob("a-1");
    expect(await reconcileScanJobs(pool, 4)).toEqual({ inspected: 0, enqueued: 0, hasMore: false });
    expect(await scanJobs()).toEqual([{ scan_id: "a-1", state: "ready", attempts: 3, priority: SCAN_JOB_PRIORITY.history, repair: false }]);
  });

  it("does not re-enqueue a scan whose current-version job failed", async () => {
    await seed(pool, "a", 1);
    await pool.query("DELETE FROM scan_read_models");
    const client = await pool.connect();
    try { await enqueueScanJob(client, "a-1", PROJECTION_VERSION, SCAN_JOB_PRIORITY.latest); } finally { client.release(); }
    await pool.query("UPDATE scan_jobs SET state = 'failed'");
    expect(await reconcileScanJobs(pool, 4)).toEqual({ inspected: 0, enqueued: 0, hasMore: false });
  });

  it("enqueues an outdated projection while the scan keeps serving", async () => {
    await seed(pool, "a", 1);
    await pool.query("UPDATE scan_read_models SET projection_version = $1", [PROJECTION_VERSION - 1]);
    expect(await reconcileScanJobs(pool, 4)).toEqual({ inspected: 1, enqueued: 1, hasMore: false });
    expect((await new PostgresDriver(pool).listRepos()).map(repo => repo.repoId)).toEqual(["a"]);
  });

  it("claims a results job only up to the chart results version", async () => {
    await enqueueChartResults(pool);
    await pool.query("UPDATE scan_jobs SET projection_version = $1", [CHART_RESULTS_VERSION + 1]);
    expect(await claimScanJob(pool, "test")).toBeNull();
    await pool.query("UPDATE scan_jobs SET projection_version = $1", [CHART_RESULTS_VERSION]);
    expect(await claimScanJob(pool, "test")).toMatchObject({ kind: "results", projectionVersion: CHART_RESULTS_VERSION });
  });
});

async function resultsJobCount(pool: Pool): Promise<number> {
  return (await pool.query("SELECT count(*)::int AS n FROM scan_jobs WHERE kind = 'results'")).rows[0].n;
}

describe.skipIf(!databaseUrl)("chart results reconciliation", { timeout: 30_000 }, () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  beforeAll(async () => { database = openReadModelDatabase(); pool = await database.pool; });
  beforeEach(async () => { await pool.query("TRUNCATE repos, scan_uploads, scan_jobs, chart_results CASCADE"); });
  afterAll(async () => { await database.close(); });

  async function writeCurrentResults() {
    await seed(pool, "a", 1);
    const job = await claimScanJob(pool, "test") as ClaimedScanJob;
    expect(await processChartResultsJob(pool, job, new AbortController().signal)).toBe("written");
  }

  it("enqueues one results job when no results are stored", async () => {
    expect(await reconcileChartResults(pool)).toBe(true);
    expect(await reconcileChartResults(pool)).toBe(false);
    expect(await resultsJobCount(pool)).toBe(1);
  });

  it("leaves a current result set alone", async () => {
    await writeCurrentResults();
    expect(await reconcileChartResults(pool)).toBe(false);
    expect(await resultsJobCount(pool)).toBe(0);
  });

  it("enqueues one results job when a stored row is outdated", async () => {
    await writeCurrentResults();
    await pool.query("UPDATE chart_results SET results_version = 0 WHERE key LIKE 'tracking:repo:%'");
    expect(await reconcileChartResults(pool)).toBe(true);
    expect(await resultsJobCount(pool)).toBe(1);
  });

  it("enqueues one results job when the stored results are more than a day old", async () => {
    await writeCurrentResults();
    await pool.query("UPDATE chart_results SET snapshot_at = now() - interval '23 hours'");
    expect(await reconcileChartResults(pool)).toBe(false);
    await pool.query("UPDATE chart_results SET snapshot_at = now() - interval '25 hours'");
    expect(await reconcileChartResults(pool)).toBe(true);
    expect(await resultsJobCount(pool)).toBe(1);
  });
});
