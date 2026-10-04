import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { withReadModelDatabase } from "../helpers/read-model-db";
import { receiveArtifact, sampleArtifact } from "../helpers/scan-artifact";

const { DATABASE_URL: databaseUrl } = process.env;

describe("worker bundle", { timeout: 30_000 }, () => {
  it("can be imported during a build without starting a server or database connection", async () => {
    const { stdout, stderr } = await promisify(execFile)(process.execPath,
      ["-e", 'require("./dist/worker.cjs"); console.log("imported");'],
      { env: { NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }, timeout: 5000 });
    expect(stdout.trim()).toBe("imported");
    expect(stderr).toBe("");
  });

  it("prints why it couldn't start when database configuration is missing", async () => {
    await expect(promisify(execFile)(process.execPath, ["dist/worker.cjs"],
      { env: { NODE_ENV: "production" }, timeout: 5000 })).rejects.toMatchObject({ code: 1, stderr: "[worker] couldn't start: DATABASE_URL is required\n" });
  });

  it.each(["127.0.0.1", "localhost"])("prints why it couldn't reach the database at %s without printing the password", async (host) => {
    const failure = await promisify(execFile)(process.execPath, ["dist/worker.cjs"],
      { env: { NODE_ENV: "production", DATABASE_URL: `postgres://scout:hunter2-secret@${host}:1/scout` }, timeout: 5000 })
      .then(() => { throw new Error("Expected the worker to fail"); }, (err: { code: number; stderr: string }) => err);
    expect(failure.code).toBe(1);
    expect(failure.stderr).toMatch(/^\[worker\] couldn't start: .*ECONNREFUSED/);
    expect(failure.stderr).not.toContain("hunter2-secret");
  });

  it.skipIf(!databaseUrl).each(["SIGTERM", "SIGINT"] as const)("processes uploads with database-only settings and exits cleanly on %s", async (signal) => {
    await withReadModelDatabase(async (pool) => {
      const uploadId = await receiveArtifact(pool, sampleArtifact());
      const listener = createServer();
      listener.listen(0, "127.0.0.1");
      await once(listener, "listening");
      const address = listener.address();
      if (!address || typeof address === "string") throw new Error("No test port");
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      const child = spawn(process.execPath, ["dist/worker.cjs"], {
        env: { NODE_ENV: "production", DATABASE_URL: pool.options.connectionString, MIGRATE_ON_START: "false", WORKER_HEALTH_PORT: String(address.port) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (data) => { output += data.toString(); });
      child.stderr.on("data", (data) => { output += data.toString(); });
      const exited = once(child, "exit");
      try {
        await expect.poll(() => output, { timeout: 10_000 }).toContain("[worker] started");
        await expect.poll(async () => (await pool.query("SELECT state FROM scan_uploads WHERE upload_id = $1", [uploadId])).rows[0].state, { timeout: 10_000 }).toBe("ready");
        expect((await fetch(`http://127.0.0.1:${address.port}/live`)).status).toBe(200);
        expect((await fetch(`http://127.0.0.1:${address.port}/ready`)).status).toBe(200);
        child.kill(signal);
        expect(await exited).toEqual([0, null]);
        expect(output).toContain("[worker] stopped");
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await exited;
        }
      }
    });
  });
});
