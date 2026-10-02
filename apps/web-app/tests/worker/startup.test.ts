import { randomBytes } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { claimScanJob } from "@/lib/scan-jobs";
import { migrateOnStart, schemaIsReady } from "@/lib/startup";
import { readWorkerConfig, startWorker } from "@/worker/entry";
import { receiveArtifact, sampleArtifact } from "../helpers/scan-artifact";

const { DATABASE_URL: serverUrl } = process.env;
describe.skipIf(!serverUrl)("worker startup", { timeout: 30_000 }, () => {
  const databaseName = `cc_worker_${randomBytes(5).toString("hex")}`;
  let admin: Client;
  let pool: Pool;
  let databaseUrl: string;
  let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
  const connectionsEnded: Promise<void>[] = [];
  beforeAll(async () => {
    admin = new Client({ connectionString: serverUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(serverUrl as string);
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    pool = new Pool({ connectionString: databaseUrl });
    pool.on("connect", (client) => {
      connectionsEnded.push(new Promise<void>((resolve) => client.once("end", resolve)));
    });
  });
  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE");
  });
  afterEach(async () => { await worker?.close(); });
  afterAll(async () => {
    await pool.end();
    await Promise.all(connectionsEnded);
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  it("waits without modifying missing schema when migrations are disabled, then observes migrations", async () => {
    const config = { ...readWorkerConfig({ DATABASE_URL: databaseUrl, MIGRATE_ON_START: "false" }), healthPort: 0, schemaCheckIntervalMs: 20 };
    worker = await startWorker(config);
    expect(worker.state.schemaReady).toBe(false);
    expect((await pool.query("SELECT to_regclass('scan_jobs') AS jobs")).rows).toEqual([{ jobs: null }]);
    expect((await fetch(`http://127.0.0.1:${worker.healthPort}/live`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${worker.healthPort}/ready`)).status).toBe(503);
    await migrateOnStart({ databaseUrl, migrationsDir: config.migrationsDir });
    await expect.poll(() => worker?.state.schemaReady, { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await fetch(`http://127.0.0.1:${worker?.healthPort}/ready`)).status, { timeout: 10_000 }).toBe(200);
  });

  it("claims and publishes a queued upload once the schema is ready", async () => {
    const config = { ...readWorkerConfig({ DATABASE_URL: databaseUrl }), healthPort: 0 };
    await migrateOnStart({ databaseUrl, migrationsDir: config.migrationsDir });
    const uploadId = await receiveArtifact(pool, sampleArtifact());
    worker = await startWorker(config);
    await expect.poll(async () => (await pool.query("SELECT state FROM scan_uploads WHERE upload_id = $1", [uploadId])).rows[0].state, { timeout: 10_000 }).toBe("ready");
    expect((await pool.query("SELECT state, lease_owner, attempts FROM scan_jobs WHERE kind = 'upload'")).rows).toEqual([{ state: "ready", lease_owner: null, attempts: 1 }]);
    expect(worker.state.processingReady).toBe(true);
    expect((await fetch(`http://127.0.0.1:${worker.healthPort}/ready`)).status).toBe(200);
    await worker.close();
    expect(worker.state.processingReady).toBe(false);
  });

  it("claims nothing while the applied schema is behind the bundled migrations", async () => {
    const config = { ...readWorkerConfig({ DATABASE_URL: databaseUrl, MIGRATE_ON_START: "false" }), healthPort: 0, schemaCheckIntervalMs: 20 };
    await migrateOnStart({ databaseUrl, migrationsDir: config.migrationsDir });
    const uploadId = await receiveArtifact(pool, sampleArtifact());
    const { rows: [latest] } = await pool.query(
      "DELETE FROM drizzle.__drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations) RETURNING hash, created_at");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      worker = await startWorker(config);
      await vi.waitFor(() => {
        expect(errors.mock.calls.filter(([message]) => message === "[worker] waiting for database schema").length).toBeGreaterThanOrEqual(3);
      }, { timeout: 10_000 });
    } finally {
      errors.mockRestore();
    }
    expect(worker.state.schemaReady).toBe(false);
    expect((await pool.query("SELECT state, attempts, lease_owner FROM scan_jobs")).rows).toEqual([{ state: "queued", attempts: 0, lease_owner: null }]);
    expect((await fetch(`http://127.0.0.1:${worker.healthPort}/ready`)).status).toBe(503);
    await pool.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [latest.hash, latest.created_at]);
    await expect.poll(async () => (await pool.query("SELECT state FROM scan_uploads WHERE upload_id = $1", [uploadId])).rows[0].state, { timeout: 10_000 }).toBe("ready");
  });

  it("releases an interrupted job for another worker when shut down mid-publication", async () => {
    const config = { ...readWorkerConfig({ DATABASE_URL: databaseUrl }), healthPort: 0 };
    await migrateOnStart({ databaseUrl, migrationsDir: config.migrationsDir });
    const uploadId = await receiveArtifact(pool, sampleArtifact());
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE scan_read_models IN SHARE MODE");
      worker = await startWorker(config);
      const running = worker;
      await expect.poll(async () => (await pool.query("SELECT stage FROM scan_jobs WHERE kind = 'upload'")).rows[0].stage, { timeout: 10_000 }).toBe("publishing");
      await expect.poll(async () => (await pool.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")).rows[0].n, { timeout: 10_000 }).toBe(1);
      const lease = (await pool.query("SELECT lease_owner FROM scan_jobs WHERE kind = 'upload'")).rows[0].lease_owner;
      expect(lease).toBe(running.owner);
      expect((await fetch(`http://127.0.0.1:${running.healthPort}/live`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${running.healthPort}/ready`)).status).toBe(200);
      const closing = running.close();
      expect((await fetch(`http://127.0.0.1:${running.healthPort}/ready`)).status).toBe(503);
      await blocker.query("ROLLBACK");
      await closing;
    } finally {
      blocker.release();
    }
    expect((await pool.query("SELECT count(*)::int AS n FROM scans")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT state FROM scan_uploads WHERE upload_id = $1", [uploadId])).rows[0].state).toBe("queued");
    expect((await pool.query("SELECT state, lease_token, available_at <= now() AS available FROM scan_jobs WHERE kind = 'upload'")).rows)
      .toEqual([{ state: "queued", lease_token: null, available: true }]);
    expect(await claimScanJob(pool, "next-worker")).toMatchObject({ uploadId });
  });

  it("rejects a journal whose latest migration is not applied", async () => {
    const config = readWorkerConfig({ DATABASE_URL: databaseUrl });
    await migrateOnStart({ databaseUrl, migrationsDir: config.migrationsDir });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations)");
      expect(await schemaIsReady(client, config.migrationsDir)).toBe(false);
    } finally { await client.query("ROLLBACK"); client.release(); }
    expect(await schemaIsReady(pool, config.migrationsDir)).toBe(true);
  });

  it("migrates before readiness and drains checked-out connections during shutdown", async () => {
    worker = await startWorker({ ...readWorkerConfig({ DATABASE_URL: databaseUrl }), healthPort: 0 });
    expect(worker.state.schemaReady).toBe(true);
    expect(worker.pool.options.max).toBe(3);
    const connection = await worker.pool.connect();
    let closed = false;
    const closing = worker.close().then(() => { closed = true; });
    expect(worker.state.stopping).toBe(true);
    const { pool: workerPool } = worker;
    await vi.waitFor(() => expect(workerPool.ending).toBe(true), { timeout: 10_000 });
    expect(closed).toBe(false);
    connection.release();
    await closing;
    expect(closed).toBe(true);
    await expect(worker.pool.query("SELECT 1")).rejects.toThrow(/end/);
  });
});
