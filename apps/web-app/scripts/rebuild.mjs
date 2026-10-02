import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { enqueueChartResults, PROJECTION_VERSION } from "@scoutui/web-shared";
import { retryFailedScanJobs } from "../src/lib/scan-jobs.ts";
import { reconcileChartResults, reconcileScanJobs, repairScanJobs } from "../src/lib/scan-reconciliation.ts";
import { failureReason } from "./failure-reason.mjs";

const RECONCILE_BATCH_SIZE = 100;
const NO_WORKER = "No worker has claimed a job; is the worker running?";

const usage = `Usage: db:rebuild [--scan <id>]... [--repair] [--retry-failed] [--wait [--timeout <seconds>]]

Queues scan rebuilds for the worker. By default, queues scans whose read models are missing or outdated,
and chart results when they are missing or outdated.

  --scan <id>       Only these scans (repeatable)
  --repair          Also rebuild scans whose read models are current
  --retry-failed    Requeue failed rebuilds
  --wait            Wait until the worker has finished the queued rebuilds
  --timeout <s>     Seconds to wait (default 1800)

Exit codes: 0 done, 1 a rebuild failed, 2 timed out waiting.`;

async function selectJobs(pool, scanIds, since, touched) {
  const { rows } = await pool.query(
    `SELECT id FROM scan_jobs WHERE kind = 'scan' AND projection_version = $1 AND ($2::text[] IS NULL OR scan_id = ANY($2))
       AND (state <> 'ready' OR created_at >= $3 OR id = ANY($4))`,
    [PROJECTION_VERSION, scanIds, since, touched],
  );
  return rows.map(row => row.id);
}

async function countJobs(pool, jobIds, results) {
  const { rows } = await pool.query(
    "SELECT state, count(*)::int AS n FROM scan_jobs WHERE id = ANY($1) OR ($2 AND kind = 'results') GROUP BY state",
    [jobIds, results],
  );
  const counts = { queued: 0, processing: 0, ready: 0, failed: 0 };
  for (const row of rows) counts[row.state] = row.n;
  return counts;
}

async function failures(pool, jobIds, results) {
  const { rows } = await pool.query(
    `SELECT kind, scan_id, error_code FROM scan_jobs WHERE (id = ANY($1) OR ($2 AND kind = 'results')) AND state = 'failed'
     ORDER BY kind, scan_id`,
    [jobIds, results],
  );
  return rows.map(row => `failed ${row.kind === "results" ? "chart results" : `scan ${row.scan_id}`}: ${row.error_code ?? "unknown"}`);
}

function format(counts) {
  return `queued ${counts.queued}, processing ${counts.processing}, ready ${counts.ready}, failed ${counts.failed}`;
}

export async function rebuild(pool, options = {}) {
  const { repair = false, retryFailed = false, wait = false, timeoutMs = 1_800_000, pollMs = 2000, log = console.log } = options;
  const scanIds = options.scanIds?.length ? options.scanIds : null;
  const { rows: [{ since }] } = await pool.query("SELECT now() AS since");

  let enqueued = 0;
  for (let pass = { hasMore: true }; pass.hasMore;) {
    pass = await reconcileScanJobs(pool, RECONCILE_BATCH_SIZE, scanIds);
    enqueued += pass.enqueued;
  }
  const repaired = repair ? await repairScanJobs(pool, scanIds) : [];
  const retried = retryFailed ? await retryFailedScanJobs(pool, scanIds) : [];
  let results = false;
  if (!scanIds) results = repair || retryFailed ? await enqueueChartResults(pool) : await reconcileChartResults(pool);
  log(`Queued ${enqueued} missing or outdated scans, ${repaired.length} for repair and ${retried.length} failed for retry${results ? ", and chart results" : ""}`);

  const jobIds = await selectJobs(pool, scanIds, since, [...repaired, ...retried]);
  const deadline = Date.now() + timeoutMs;
  let first;
  let claimed = false;
  let last = "";
  for (;;) {
    const counts = await countJobs(pool, jobIds, !scanIds);
    first ??= counts;
    if (counts.processing > 0 || counts.queued < first.queued) claimed = true;
    const line = format(counts);
    if (line !== last) log(line);
    last = line;
    const settled = counts.queued === 0 && counts.processing === 0;
    const timedOut = wait && !settled && Date.now() >= deadline;
    if (!wait || settled || timedOut) {
      for (const failure of await failures(pool, jobIds, !scanIds)) log(failure);
      if (timedOut) log(claimed ? `Timed out after ${Math.round(timeoutMs / 1000)} seconds` : NO_WORKER);
      return { ...counts, timedOut };
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      scan: { type: "string", multiple: true },
      repair: { type: "boolean", default: false },
      "retry-failed": { type: "boolean", default: false },
      wait: { type: "boolean", default: false },
      timeout: { type: "string", default: "1800" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const timeoutSeconds = Number(values.timeout);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error("--timeout must be a positive number of seconds");
  const { DATABASE_URL: connectionString } = process.env;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString });
  try {
    const result = await rebuild(pool, {
      scanIds: values.scan, repair: values.repair, retryFailed: values["retry-failed"], wait: values.wait, timeoutMs: timeoutSeconds * 1000,
    });
    process.exitCode = result.failed > 0 ? 1 : result.timedOut ? 2 : 0;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? failureReason(error) : error);
    process.exitCode = 1;
  });
}
