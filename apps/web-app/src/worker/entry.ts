import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Pool } from "pg";
import { errorClass } from "../lib/scan-jobs";
import { reconcileChartResults, reconcileScanJobs } from "../lib/scan-reconciliation";
import { positiveInteger, readScanUploadConfig } from "../lib/scan-upload-config";
import { migrateOnStart, migrateOnStartEnabled, resolveMigrationsDir, schemaIsReady } from "../lib/startup";
import { startWorkerHealthServer } from "./health";
import { runScanJobs } from "./runner";

export { errorReason } from "../lib/error-reason";

type Env = Record<string, string | undefined>;

export function readWorkerConfig(env: Env) {
  const { DATABASE_URL: databaseUrl } = env;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  readScanUploadConfig(env);
  const poolMax = positiveInteger(env, "WORKER_DATABASE_POOL_MAX") ?? 3;
  if (poolMax < 3) {
    throw new Error("WORKER_DATABASE_POOL_MAX must be at least 3; a job, its lease heartbeat and reconciliation each need a connection");
  }
  return {
    databaseUrl,
    migrateOnStart: migrateOnStartEnabled(env),
    migrationsDir: resolveMigrationsDir(env),
    poolMax,
    healthPort: positiveInteger(env, "WORKER_HEALTH_PORT", 65535) ?? 3001,
    schemaCheckIntervalMs: positiveInteger(env, "WORKER_SCHEMA_CHECK_INTERVAL_MS", 2147483647) ?? 5000,
    shutdownTimeoutMs: positiveInteger(env, "WORKER_SHUTDOWN_TIMEOUT_MS", 2147483647) ?? 30000,
    reconcileIntervalMs: positiveInteger(env, "WORKER_RECONCILE_INTERVAL_MS", 2147483647) ?? 300000,
    reconcileBatchSize: positiveInteger(env, "WORKER_RECONCILE_BATCH_SIZE") ?? 100,
  };
}

export async function startWorker(config: ReturnType<typeof readWorkerConfig>) {
  const state = { schemaReady: false, processingReady: false, stopping: false };
  const owner = `${hostname()}:${process.pid}:${randomUUID()}`;
  const processing = new AbortController();
  let running: Promise<void> | undefined;
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.poolMax,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    application_name: "scout-worker",
  });
  pool.on("error", () => {
    state.schemaReady = false;
    console.error("[worker] database connection lost");
  });
  const health = await startWorkerHealthServer({
    port: config.healthPort,
    isReady: () => state.schemaReady && state.processingReady && !state.stopping,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checking: Promise<void> | undefined;
  let reconcileTimer: ReturnType<typeof setTimeout> | undefined;
  let reconciling: Promise<void> | undefined;
  async function reconcile() {
    try {
      let enqueued = 0;
      for (let hasMore = true; hasMore && !state.stopping;) {
        const pass = await reconcileScanJobs(pool, config.reconcileBatchSize);
        enqueued += pass.enqueued;
        hasMore = pass.hasMore;
      }
      if (enqueued > 0) console.log(`[worker] reconciliation enqueued ${enqueued} scan jobs`);
      if (!state.stopping && await reconcileChartResults(pool)) console.log("[worker] reconciliation enqueued a results job");
    } catch (error) {
      console.error(`[worker] reconciliation failed (${errorClass(error)})`);
    }
    if (!state.stopping) reconcileTimer = setTimeout(() => { reconciling = reconcile(); }, config.reconcileIntervalMs);
  }
  function startProcessing() {
    state.processingReady = true;
    console.log("[worker] processing scan jobs");
    running = runScanJobs(pool, { owner, signal: processing.signal }).then(() => {
      state.processingReady = false;
    }, (error: unknown) => {
      state.processingReady = false;
      console.error(`[worker] scan job processing stopped (${error instanceof Error ? error.name : "unknown"})`);
    });
    reconciling = reconcile();
  }
  async function checkSchema() {
    try {
      state.schemaReady = await schemaIsReady(pool, config.migrationsDir);
      if (!state.schemaReady) console.error("[worker] waiting for database schema");
    } catch {
      state.schemaReady = false;
      console.error("[worker] database schema check failed");
    }
    if (state.schemaReady && !running && !state.stopping) startProcessing();
    if (!state.stopping) timer = setTimeout(() => { checking = checkSchema(); }, config.schemaCheckIntervalMs);
  }
  try {
    if (config.migrateOnStart) {
      await migrateOnStart({ databaseUrl: config.databaseUrl, migrationsDir: config.migrationsDir });
    }
    checking = checkSchema();
    await checking;
  } catch (error) {
    await Promise.all([health.close(), pool.end()]);
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    pool,
    state,
    owner,
    healthPort: health.port,
    close() {
      state.stopping = true;
      clearTimeout(timer);
      clearTimeout(reconcileTimer);
      processing.abort();
      closing ??= (async () => {
        await checking;
        await running;
        await reconciling;
        await Promise.all([health.close(), pool.end()]);
      })();
      return closing;
    },
  };
}

export async function main(env: Env = process.env): Promise<void> {
  const config = readWorkerConfig(env);
  const starting = startWorker(config);
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => {
      console.error("[worker] shutdown deadline exceeded");
      process.exit(1);
    }, config.shutdownTimeoutMs);
    deadline.unref();
    void starting.then((worker) => worker.close()).then(() => {
      clearTimeout(deadline);
      process.off("SIGTERM", shutdown);
      process.off("SIGINT", shutdown);
      console.log("[worker] stopped");
    }).catch(() => {
      console.error("[worker] shutdown failed");
      process.exit(1);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  try {
    await starting;
    console.log("[worker] started");
  } catch (error) {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    throw error;
  }
}
