import type { Pool, PoolClient } from "pg";
import {
  CHART_RESULTS_FORMAT_VERSION, CHART_RESULTS_VERSION, chartResultRows, deriveChartResults, PostgresDriver, ReadModelUnavailableError,
  type ChartResultsInput,
} from "@scoutui/web-shared";
import { skippedNotices } from "./read-model-progress.ts";
import { completeResultsJob, setScanJobStage, type ClaimedScanJob } from "./scan-jobs.ts";

const CHART_RESULTS_LOCK_KEY = 20_260_924;

async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>, begin = "BEGIN"): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(begin);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

type Snapshot = { snapshotAt: string; inputs: ChartResultsInput };

async function readSnapshot(pool: Pool): Promise<Snapshot | null> {
  try {
    return await inTransaction(pool, async client => {
      const { rows } = await client.query<{ snapshot_at: string }>("SELECT clock_timestamp()::text AS snapshot_at");
      const [clock] = rows as [{ snapshot_at: string }];
      const driver = new PostgresDriver(pool, client);
      const inputs = {
        digests: await driver.listScanDigests(), tags: await driver.listTags(),
        governance: await driver.listGovernance(), dashboards: await driver.listDashboards(),
      };
      return await skippedNotices(pool, driver.skippedScans()) ? { snapshotAt: clock.snapshot_at, inputs } : null;
    }, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  } catch (error) {
    if (error instanceof ReadModelUnavailableError) return null;
    throw error;
  }
}

/**
 * Replaces the stored chart results with a derivation of one read snapshot, which leaves out the scans that aren't
 * ready. Defers without writing while a scan is being rebuilt, and never replaces rows derived from a later snapshot.
 */
export async function processChartResultsJob(pool: Pool, job: ClaimedScanJob, signal: AbortSignal): Promise<"written" | "deferred" | "superseded"> {
  const guard = { jobId: job.id, leaseToken: job.leaseToken };
  await setScanJobStage(pool, job, "deriving");
  const snapshot = await readSnapshot(pool);
  if (!snapshot) {
    await inTransaction(pool, client => completeResultsJob(client, guard));
    return "deferred";
  }
  signal.throwIfAborted();
  const rows = chartResultRows(deriveChartResults(snapshot.inputs));
  const records = JSON.stringify(rows);
  signal.throwIfAborted();
  return inTransaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [CHART_RESULTS_LOCK_KEY]);
    const { rows: [fence] } = await client.query<{ superseded: boolean }>(
      "SELECT COALESCE((SELECT max(snapshot_at) FROM chart_results) > $1::timestamptz, false) AS superseded",
      [snapshot.snapshotAt]);
    if (fence?.superseded) {
      await completeResultsJob(client, guard);
      return "superseded";
    }
    await client.query("DELETE FROM chart_results");
    await client.query(`INSERT INTO chart_results (key, results_version, format_version, snapshot_at, payload)
      SELECT record.key, $2, $3, $4::timestamptz, record.payload FROM json_to_recordset($1::json) AS record(key text, payload json)`,
    [records, CHART_RESULTS_VERSION, CHART_RESULTS_FORMAT_VERSION, snapshot.snapshotAt]);
    await completeResultsJob(client, guard);
    return "written";
  });
}
