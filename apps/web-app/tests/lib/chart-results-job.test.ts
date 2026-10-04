import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHART_RESULTS_FORMAT_VERSION, CHART_RESULTS_VERSION, chartResultKey, chartResultRows, deriveChartResults, enqueueChartResults, PostgresDriver,
} from "@scoutui/web-shared";
import { processChartResultsJob } from "@/lib/chart-results-job";
import { chartResultsUnavailable } from "@/lib/read-model-progress";
import { claimScanJob, failScanJob, retryScanJob, ScanJobLeaseError, type ClaimedScanJob } from "@/lib/scan-jobs";
import { publishScan } from "@/lib/scan-projection";
import { processScanJob } from "@/worker/runner";
import { openReadModelDatabase } from "../helpers/read-model-db";
import { sampleArtifact } from "../helpers/scan-artifact";

// biome-ignore lint/complexity/useLiteralKeys: env access
const databaseUrl = process.env["DATABASE_URL"];
const signal = new AbortController().signal;

type QueryHook = (query: string) => Promise<void> | void;

function interceptClientQueries(pool: Pool, hook: QueryHook): Pool {
  return new Proxy(pool, {
    get(target, key) {
      if (key !== "connect") {
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(connection, property) {
            if (property === "query") return async (query: string | { text: string }, ...rest: unknown[]) => {
              await hook(typeof query === "string" ? query : query.text);
              return (connection.query as (...args: unknown[]) => Promise<unknown>)(query, ...rest);
            };
            const value = Reflect.get(connection, property);
            return typeof value === "function" ? value.bind(connection) : value;
          },
        });
      };
    },
  });
}

function publish(pool: Pool, scanId: string, repoId = "repo-a", scannedAt = "2026-09-19T00:00:00Z") {
  return publishScan(pool, sampleArtifact({ scanId, repoId, scannedAt }), { uploadedByUserId: null });
}

async function resultsJobs(pool: Pool): Promise<{ id: string; state: string }[]> {
  return (await pool.query("SELECT id, state FROM scan_jobs WHERE kind = 'results' ORDER BY sequence")).rows;
}

async function storedRows(pool: Pool) {
  return (await pool.query("SELECT key, results_version, format_version, payload FROM chart_results ORDER BY key")).rows;
}

async function expectedRows(pool: Pool) {
  const { rows: [stored] } = await pool.query<{ snapshot_at: string }>("SELECT snapshot_at::text FROM chart_results LIMIT 1");
  if (!stored) throw new Error("Expected stored chart results");
  const inputs = await new PostgresDriver(pool).withReadSnapshot(async driver => ({
    digests: await driver.listScanDigests(), tags: await driver.listTags(),
    governance: await driver.listGovernance(), dashboards: await driver.listDashboards(),
    asOf: new Date(stored.snapshot_at).toISOString(),
  }));
  return chartResultRows(deriveChartResults(inputs))
    .map(row => ({ key: row.key, results_version: CHART_RESULTS_VERSION, format_version: CHART_RESULTS_FORMAT_VERSION, payload: JSON.parse(JSON.stringify(row.payload)) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

async function claimResults(pool: Pool, owner = "results-test"): Promise<ClaimedScanJob> {
  const job = await claimScanJob(pool, owner);
  expect(job).toMatchObject({ kind: "results", uploadId: null, scanId: null, projectionVersion: CHART_RESULTS_VERSION });
  return job as ClaimedScanJob;
}

async function expireAndReclaim(pool: Pool, job: ClaimedScanJob): Promise<ClaimedScanJob> {
  await pool.query("UPDATE scan_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [job.id]);
  const reclaimed = await claimScanJob(pool, "reclaimer");
  expect(reclaimed).toMatchObject({ id: job.id, attempt: job.attempt + 1 });
  return reclaimed as ClaimedScanJob;
}

describe.skipIf(!databaseUrl)("chart results job", { timeout: 30_000 }, () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  beforeAll(async () => { database = openReadModelDatabase(); pool = await database.pool; });
  beforeEach(async () => { await pool.query("TRUNCATE repos, scan_uploads, scan_jobs, chart_results, dashboards, governance, tags CASCADE"); });
  afterAll(async () => { await database.close(); });

  it("enqueues one results job when a publication inserts or rebuilds a scan, and none when it already exists", async () => {
    expect(await publish(pool, "scan-a")).toMatchObject({ status: "inserted" });
    expect(await resultsJobs(pool)).toEqual([{ id: expect.any(String), state: "queued" }]);
    await pool.query("DELETE FROM scan_jobs");
    expect(await publish(pool, "scan-a")).toMatchObject({ status: "exists" });
    expect(await resultsJobs(pool)).toEqual([]);
    await pool.query("UPDATE scan_read_models SET projection_version = 0");
    expect(await publish(pool, "scan-a")).toMatchObject({ status: "rebuilt" });
    expect(await resultsJobs(pool)).toEqual([{ id: expect.any(String), state: "queued" }]);
  });

  it("enqueues nothing when the publication rolls back", async () => {
    let enqueued = false;
    const failing = interceptClientQueries(pool, query => {
      if (query.includes("'results'")) enqueued = true;
      if (enqueued && query === "COMMIT") throw new Error("Injected commit failure");
    });
    await expect(publish(failing, "scan-a")).rejects.toThrow(/Injected/);
    expect(enqueued).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS n FROM scans")).rows[0].n).toBe(0);
    expect(await resultsJobs(pool)).toEqual([]);
  });

  it("coalesces publications into one queued results job", async () => {
    await publish(pool, "scan-a");
    await publish(pool, "scan-b", "repo-b");
    expect(await resultsJobs(pool)).toEqual([{ id: expect.any(String), state: "queued" }]);
  });

  it("stores the derivation of one snapshot and deletes the job", async () => {
    const driver = new PostgresDriver(pool);
    await driver.upsertTag({ value: "core", category: "library", color: "teal", rule: { glob: ["@sample/*"], exact: [] } });
    await driver.createGovernance({ grain: "package", targetPackage: "@sample/core", targetExport: null, disposition: { kind: "retired", reason: "Retired" } });
    const dashboard = await driver.upsertDashboard({ visibility: "everyone", name: "Library usage", description: null, config: { scope: { kind: "all" }, cohorts: [{ kind: "package", packageName: "@sample/core" }], chartType: "trend", metric: "count" } });
    await publish(pool, "scan-a", "repo-a", "2026-09-18T00:00:00Z");
    await publish(pool, "scan-b", "repo-a", "2026-09-19T00:00:00Z");
    await publish(pool, "scan-c", "repo-b");
    const job = await claimResults(pool);
    expect(await processChartResultsJob(pool, job, signal)).toBe("written");
    const stored = await storedRows(pool);
    expect(stored).toEqual(await expectedRows(pool));
    expect(stored.map(row => row.key)).toEqual(expect.arrayContaining([
      chartResultKey.tracking, chartResultKey.registry, chartResultKey.repoTracking("repo-a"), chartResultKey.repoTracking("repo-b"), chartResultKey.preview(dashboard.id),
    ]));
    expect(await resultsJobs(pool)).toEqual([]);
  });

  it("dispatches a claimed results job from the worker", async () => {
    await publish(pool, "scan-a");
    await processScanJob(pool, await claimResults(pool), signal);
    expect(await storedRows(pool)).toEqual(await expectedRows(pool));
    expect(await resultsJobs(pool)).toEqual([]);
  });

  it.each([
    { state: "being rebuilt", outcome: "deferred" },
    { state: "being prepared for the first time", outcome: "written" },
    { state: "failed", outcome: "written" },
  ] as const)("leaves out a scan $state, and the job is $outcome", async ({ state, outcome }) => {
    await publish(pool, "scan-a");
    await processChartResultsJob(pool, await claimResults(pool), signal);
    const before = await storedRows(pool);
    await publish(pool, "scan-b", "repo-b");
    if (state === "being rebuilt") await pool.query("UPDATE scan_read_models SET format_version = format_version + 1 WHERE scan_id = 'scan-b'");
    else await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'scan-b'");
    await pool.query(`INSERT INTO scan_jobs (id, scan_id, projection_version, kind, state, available_at)
      VALUES ('scan-b-job', 'scan-b', 1, 'scan', $1, now() + interval '1 day')`, [state === "failed" ? "failed" : "queued"]);
    expect(await processChartResultsJob(pool, await claimResults(pool), signal)).toBe(outcome);
    expect(await storedRows(pool)).toEqual(before);
    expect(await resultsJobs(pool)).toEqual([]);
  });

  it("clears an earlier failed results job once a later one defers", async () => {
    await publish(pool, "scan-a");
    await failScanJob(pool, await claimResults(pool), { code: "results_failed", message: "Results failed" });
    await publish(pool, "scan-b", "repo-b");
    await pool.query("UPDATE scan_read_models SET format_version = format_version + 1 WHERE scan_id = 'scan-b'");
    expect(await processChartResultsJob(pool, await claimResults(pool), signal)).toBe("deferred");
    expect(await resultsJobs(pool)).toEqual([]);
    expect(await chartResultsUnavailable(pool)).toEqual({ state: "preparing", scans: [], retryable: true });
  });

  it("never replaces results from a later snapshot", async () => {
    await publish(pool, "scan-a");
    const job = await claimResults(pool);
    await pool.query(`INSERT INTO chart_results (key, results_version, format_version, snapshot_at, payload)
      VALUES ('registry', $1, $2, clock_timestamp() + interval '1 hour', '{"later":true}')`,
    [CHART_RESULTS_VERSION, CHART_RESULTS_FORMAT_VERSION]);
    const before = await storedRows(pool);
    expect(await processChartResultsJob(pool, job, signal)).toBe("superseded");
    expect(await storedRows(pool)).toEqual(before);
    expect(await resultsJobs(pool)).toEqual([]);
  });

  it("a job enqueued by a publication that started earlier but committed later still writes", async () => {
    const earlier = await pool.connect();
    try {
      await earlier.query("BEGIN");
      const config = { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" };
      const { rows: [dashboard] } = await earlier.query<{ id: string }>(
        "INSERT INTO dashboards (id, name, description, config) VALUES (gen_random_uuid()::text, 'Local usage', null, $1::jsonb) RETURNING id",
        [JSON.stringify(config)]);
      if (!dashboard) throw new Error("dashboard insert returned no row");
      await publish(pool, "scan-a");
      expect(await processChartResultsJob(pool, await claimResults(pool), signal)).toBe("written");
      await enqueueChartResults(earlier);
      await earlier.query("COMMIT");
      expect(await processChartResultsJob(pool, await claimResults(pool), signal)).toBe("written");
      expect(await storedRows(pool)).toEqual(await expectedRows(pool));
      expect((await storedRows(pool)).map(row => row.key)).toContain(chartResultKey.preview(dashboard.id));
    } finally {
      await earlier.query("ROLLBACK").catch(() => {});
      earlier.release();
    }
  });

  it("a retried results job that absorbed a later write is not superseded", async () => {
    await publish(pool, "scan-a");
    const first = await claimResults(pool);
    await enqueueChartResults(pool);
    expect(await processChartResultsJob(pool, await claimResults(pool, "other-worker"), signal)).toBe("written");
    await retryScanJob(pool, first, 0, null);
    const dashboard = await new PostgresDriver(pool).upsertDashboard({ visibility: "everyone", name: "Local usage", description: null, config: { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" } });
    await enqueueChartResults(pool);
    const retried = await claimResults(pool);
    expect(retried).toMatchObject({ id: first.id, attempt: 2 });
    expect(await processChartResultsJob(pool, retried, signal)).toBe("written");
    expect((await storedRows(pool)).map(row => row.key)).toContain(chartResultKey.preview(dashboard.id));
  });

  it("holds a queued results job from claims until the enqueuing write commits", async () => {
    await enqueueChartResults(pool);
    const writer = await pool.connect();
    try {
      await writer.query("BEGIN");
      await enqueueChartResults(writer);
      expect(await claimScanJob(pool, "results-test")).toBeNull();
      await writer.query("COMMIT");
    } finally {
      await writer.query("ROLLBACK").catch(() => {});
      writer.release();
    }
    expect(await claimScanJob(pool, "results-test")).toMatchObject({ kind: "results" });
  });

  it("queues a new results job when the queued one is claimed while the enqueue waits", async () => {
    await enqueueChartResults(pool);
    let enqueuing: Promise<unknown> | undefined;
    const claiming = interceptClientQueries(pool, async query => {
      if (query !== "COMMIT" || enqueuing) return;
      enqueuing = enqueueChartResults(pool);
      await vi.waitFor(async () => {
        const { rows: [waiting] } = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event <> 'advisory'`);
        expect(waiting.n).toBe(1);
      }, { timeout: 10_000 });
    });
    const claimed = await claimScanJob(claiming, "results-test");
    await expect(enqueuing).resolves.toBe(true);
    expect(await resultsJobs(pool)).toEqual([{ id: claimed?.id, state: "processing" }, { id: expect.any(String), state: "queued" }]);
  });

  it("a write during derivation leaves a queued results job", async () => {
    await publish(pool, "scan-a");
    const job = await claimResults(pool);
    await enqueueChartResults(pool);
    expect(await processChartResultsJob(pool, job, signal)).toBe("written");
    const remaining = await resultsJobs(pool);
    expect(remaining).toEqual([{ id: expect.any(String), state: "queued" }]);
    expect(remaining[0]?.id).not.toBe(job.id);
  });

  it("retry while another is queued", async () => {
    await publish(pool, "scan-a");
    const job = await claimResults(pool);
    await enqueueChartResults(pool);
    await retryScanJob(pool, job, 0, null);
    const remaining = await resultsJobs(pool);
    expect(remaining).toEqual([{ id: expect.any(String), state: "queued" }]);
    expect(remaining[0]?.id).not.toBe(job.id);
  });

  it("returns a results job to the queue when no other is queued", async () => {
    await publish(pool, "scan-a");
    const job = await claimResults(pool);
    await retryScanJob(pool, job, 0, null);
    expect(await resultsJobs(pool)).toEqual([{ id: job.id, state: "queued" }]);
  });

  it("fences the write of an attempt whose lease was reclaimed", async () => {
    await publish(pool, "scan-a");
    const original = await claimResults(pool);
    const other = new Pool({ ...pool.options, max: 1 });
    try {
      let reclaimed: ClaimedScanJob | undefined;
      const racing = interceptClientQueries(pool, async query => {
        if (!reclaimed && query.startsWith("SELECT pg_advisory_xact_lock")) reclaimed = await expireAndReclaim(other, original);
      });
      await expect(processChartResultsJob(racing, original, signal)).rejects.toBeInstanceOf(ScanJobLeaseError);
      expect(reclaimed).toBeDefined();
      expect(await storedRows(pool)).toEqual([]);
      expect((await pool.query("SELECT state, lease_token FROM scan_jobs WHERE id = $1", [original.id])).rows)
        .toEqual([{ state: "processing", lease_token: reclaimed?.leaseToken }]);
    } finally { await other.end(); }
  });

  it("drops the preview of a deleted dashboard on the next job", async () => {
    const driver = new PostgresDriver(pool);
    const dashboard = await driver.upsertDashboard({ visibility: "everyone", name: "Local usage", description: null, config: { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" } });
    await publish(pool, "scan-a");
    await processChartResultsJob(pool, await claimResults(pool), signal);
    expect((await storedRows(pool)).map(row => row.key)).toContain(chartResultKey.preview(dashboard.id));
    await driver.deleteDashboard(dashboard.id);
    await enqueueChartResults(pool);
    expect(await processChartResultsJob(pool, await claimResults(pool), signal)).toBe("written");
    expect((await storedRows(pool)).map(row => row.key)).not.toContain(chartResultKey.preview(dashboard.id));
  });
});
