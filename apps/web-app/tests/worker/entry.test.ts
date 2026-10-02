import { hostname } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECTION_VERSION } from "@scoutui/web-shared";
import { publishScan } from "@/lib/scan-projection";
import { readWorkerConfig, startWorker } from "@/worker/entry";
import { startWorkerHealthServer } from "@/worker/health";
import { withReadModelDatabase } from "../helpers/read-model-db";
import { sampleArtifact } from "../helpers/scan-artifact";

// biome-ignore lint/complexity/useLiteralKeys: env access
const databaseUrl = process.env["DATABASE_URL"];
const loop = vi.hoisted(() => ({ owners: [] as string[], fail: (_error: Error) => {}, real: false }));
vi.mock("@/worker/runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/worker/runner")>();
  return {
    runScanJobs: (...args: Parameters<typeof actual.runScanJobs>) => {
      const [, options] = args;
      loop.owners.push(options.owner);
      if (loop.real) return actual.runScanJobs(...args);
      return new Promise<void>((resolve, reject) => {
        loop.fail = reject;
        options.signal.addEventListener("abort", () => resolve());
      });
    },
  };
});
vi.mock("@/lib/startup", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/startup")>(),
  schemaIsReady: async () => true,
}));

describe("worker configuration", () => {
  it("uses its own pool limit and needs no authentication settings", () => {
    expect(readWorkerConfig({ DATABASE_URL: "postgres://localhost/worker", DATABASE_POOL_MAX: "30" })).toMatchObject({
      databaseUrl: "postgres://localhost/worker", poolMax: 3, healthPort: 3001, schemaCheckIntervalMs: 5000,
      shutdownTimeoutMs: 30000, reconcileIntervalMs: 300000, reconcileBatchSize: 100,
    });
    expect(readWorkerConfig({ DATABASE_URL: "postgres://localhost/worker", WORKER_DATABASE_POOL_MAX: "4" }).poolMax).toBe(4);
  });

  it("requires a pool of at least three connections", () => {
    expect(() => readWorkerConfig({ DATABASE_URL: "postgres://localhost/worker", WORKER_DATABASE_POOL_MAX: "2" }))
      .toThrow("WORKER_DATABASE_POOL_MAX must be at least 3; a job, its lease heartbeat and reconciliation each need a connection");
    expect(readWorkerConfig({ DATABASE_URL: "postgres://localhost/worker", WORKER_DATABASE_POOL_MAX: "3" }).poolMax).toBe(3);
  });

  it.each(["0", "-1", "1.5", "2junk", "NaN"])("rejects invalid pool limits %s", (value) => {
    expect(() => readWorkerConfig({ DATABASE_URL: "postgres://localhost/worker", WORKER_DATABASE_POOL_MAX: value })).toThrow(/WORKER_DATABASE_POOL_MAX/);
  });

  it("rejects missing database and invalid health or timer settings", () => {
    expect(() => readWorkerConfig({})).toThrow(/DATABASE_URL/);
    for (const key of ["WORKER_HEALTH_PORT", "WORKER_SCHEMA_CHECK_INTERVAL_MS", "WORKER_SHUTDOWN_TIMEOUT_MS", "WORKER_RECONCILE_INTERVAL_MS", "WORKER_RECONCILE_BATCH_SIZE"]) {
      expect(() => readWorkerConfig({ DATABASE_URL: "postgres://localhost/worker", [key]: "0" })).toThrow(key);
    }
    expect(() => readWorkerConfig({ DATABASE_URL: "postgres://localhost/worker", WORKER_HEALTH_PORT: "65536" })).toThrow(/WORKER_HEALTH_PORT/);
  });

  it("validates the shared scan upload settings", () => {
    expect(() => readWorkerConfig({ DATABASE_URL: "postgres://localhost/worker", SCOUTUI_MAX_DECODED_ARTIFACT_BYTES: "64MiB" })).toThrow("SCOUTUI_MAX_DECODED_ARTIFACT_BYTES");
    expect(() => readWorkerConfig({ DATABASE_URL: "postgres://localhost/worker", SCOUTUI_MAX_UPLOAD_BYTES: "0" })).toThrow("SCOUTUI_MAX_UPLOAD_BYTES");
  });
});

describe("worker health", () => {
  let server: Awaited<ReturnType<typeof startWorkerHealthServer>> | undefined;
  afterEach(async () => { await server?.close(); });

  it("keeps liveness independent of schema and processing readiness", async () => {
    let ready = false;
    server = await startWorkerHealthServer({ port: 0, host: "127.0.0.1", isReady: () => ready });
    const base = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${base}/live`)).status).toBe(200);
    expect((await fetch(`${base}/ready`)).status).toBe(503);
    ready = true;
    expect((await fetch(`${base}/ready`)).status).toBe(200);
    expect((await fetch(`${base}/unknown`)).status).toBe(404);
    ready = false;
    expect((await fetch(`${base}/live`)).status).toBe(200);
    await server.close();
    await expect(fetch(`${base}/live`)).rejects.toThrow();
  });

  it("rejects port conflicts without leaving a second server running", async () => {
    server = await startWorkerHealthServer({ port: 0, host: "127.0.0.1", isReady: () => false });
    await expect(startWorkerHealthServer({ port: server.port, host: "127.0.0.1", isReady: () => false })).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
});

describe("worker processing readiness", () => {
  let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
  afterEach(async () => {
    await worker?.close();
    vi.restoreAllMocks();
  });
  const config = () => ({ ...readWorkerConfig({ DATABASE_URL: "postgres://127.0.0.1:1/unused", MIGRATE_ON_START: "false" }), healthPort: 0 });

  it("drops readiness when the processing loop fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    worker = await startWorker(config());
    const ready = `http://127.0.0.1:${worker.healthPort}/ready`;
    expect(worker.state.processingReady).toBe(true);
    expect((await fetch(ready)).status).toBe(200);
    loop.fail(new TypeError("broken"));
    await expect.poll(async () => (await fetch(ready)).status).toBe(503);
    expect(worker.state.processingReady).toBe(false);
    expect(errors).toHaveBeenCalledWith("[worker] scan job processing stopped (TypeError)");
    expect((await fetch(`http://127.0.0.1:${worker.healthPort}/live`)).status).toBe(200);
  });

  it("claims under an owner unique to each worker", async () => {
    loop.owners.length = 0;
    worker = await startWorker(config());
    const first = worker;
    worker = await startWorker(config());
    await first.close();
    expect(loop.owners).toEqual([first.owner, worker.owner]);
    expect(first.owner).not.toBe(worker.owner);
    expect(first.owner.startsWith(`${hostname()}:${process.pid}:`)).toBe(true);
  });
});

describe.skipIf(!databaseUrl)("worker reconciliation", { timeout: 30_000 }, () => {
  afterEach(() => {
    loop.real = false;
    vi.restoreAllMocks();
  });

  it("rebuilds a scan whose read model is missing", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, sampleArtifact(), { uploadedByUserId: null });
      await pool.query("DELETE FROM scan_read_models");
      loop.real = true;
      const logs = vi.spyOn(console, "log").mockImplementation(() => {});
      const { connectionString } = pool.options;
      const worker = await startWorker({ ...readWorkerConfig({ DATABASE_URL: connectionString, MIGRATE_ON_START: "false" }), healthPort: 0 });
      try {
        await vi.waitFor(async () => {
          expect((await pool.query("SELECT state, projection_version FROM scan_read_models")).rows)
            .toEqual([{ state: "ready", projection_version: PROJECTION_VERSION }]);
        }, { timeout: 15_000, interval: 100 });
        expect(logs).toHaveBeenCalledWith("[worker] reconciliation enqueued 1 scan jobs");
      } finally {
        await worker.close();
      }
    });
  });

  it("stores chart results when none are stored", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, sampleArtifact(), { uploadedByUserId: null });
      await pool.query("DELETE FROM scan_jobs");
      loop.real = true;
      const logs = vi.spyOn(console, "log").mockImplementation(() => {});
      const { connectionString } = pool.options;
      const worker = await startWorker({ ...readWorkerConfig({ DATABASE_URL: connectionString, MIGRATE_ON_START: "false" }), healthPort: 0 });
      try {
        await vi.waitFor(async () => {
          expect((await pool.query("SELECT count(*)::int AS n FROM chart_results WHERE key = 'registry'")).rows[0].n).toBe(1);
        }, { timeout: 15_000, interval: 100 });
        expect(logs).toHaveBeenCalledWith("[worker] reconciliation enqueued a results job");
      } finally {
        await worker.close();
      }
    });
  });
});
