import { createHash, randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECTION_VERSION } from "@scoutui/web-shared";
import { receiveUpload, readArchive } from "@/lib/scan-archive";
import { UPLOAD_QUEUE_LOCK_KEY, uploadQueueFull } from "@/lib/scan-jobs";
import { openReadModelDatabase } from "../helpers/read-model-db";

// biome-ignore lint/complexity/useLiteralKeys: env access
const databaseUrl = process.env["DATABASE_URL"];
const limits = { maxWireBytes: 4 * 1024 * 1024, maxStoredBytes: 4 * 1024 * 1024, timeoutMs: 5000 };
async function* input(...chunks: Uint8Array[]) { yield* chunks; }

describe.skipIf(!databaseUrl)("opaque upload archive", { timeout: 30_000 }, () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  beforeAll(async () => { database = openReadModelDatabase(); pool = await database.pool; });
  beforeEach(async () => { await pool.query("TRUNCATE scan_uploads CASCADE"); });
  afterAll(async () => { await database.close(); });

  async function counts() {
    return (await pool.query(`SELECT
      (SELECT count(*)::int FROM scan_uploads) AS uploads,
      (SELECT count(*)::int FROM scan_artifact_chunks) AS chunks,
      (SELECT count(*)::int FROM scan_jobs) AS jobs`)).rows[0];
  }
  async function archive(uploadId: string) {
    const client = await pool.connect();
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of readArchive(client, uploadId)) chunks.push(chunk);
      return Buffer.concat(chunks);
    } finally { client.release(); }
  }

  it("durably stores invalid gzip without decoding and splits oversized input chunks", async () => {
    const bytes = randomBytes(2 * 1024 * 1024 + 17);
    const { uploadId } = await receiveUpload(pool, input(bytes), "gzip", null, limits, new AbortController().signal);
    expect(await archive(uploadId)).toEqual(bytes);
    expect(await counts()).toEqual({ uploads: 1, chunks: 3, jobs: 1 });
    const receipt = (await pool.query("SELECT * FROM scan_uploads WHERE upload_id = $1", [uploadId])).rows[0];
    expect(receipt).toMatchObject({ state: "queued", encoding: "gzip", scan_id: null,
      stored_bytes: String(bytes.length), checksum: createHash("sha256").update(bytes).digest("hex") });
    const fresh = new Pool(pool.options);
    try { expect((await fresh.query("SELECT state, projection_version FROM scan_jobs WHERE upload_id = $1", [uploadId])).rows[0]).toEqual({ state: "queued", projection_version: PROJECTION_VERSION }); }
    finally { await fresh.end(); }
  });

  it("compresses identity input incrementally and counts UTF-8 bytes", async () => {
    const bytes = Buffer.from('"☀️"');
    const { uploadId } = await receiveUpload(pool, input(bytes.subarray(0, 3), bytes.subarray(3)), "identity", null, limits, new AbortController().signal);
    expect(gunzipSync(await archive(uploadId))).toEqual(bytes);
    await expect(receiveUpload(pool, input(bytes), "identity", null, { ...limits, maxWireBytes: bytes.length - 1 }, new AbortController().signal)).rejects.toMatchObject({ code: "wire_limit" });
    expect((await counts()).uploads).toBe(1);
  });

  it("rolls back every row when input ends with an error", async () => {
    async function* interrupted() { yield randomBytes(1024 * 1024); throw new Error("disconnected"); }
    await expect(receiveUpload(pool, interrupted(), "gzip", null, limits, new AbortController().signal)).rejects.toThrow("disconnected");
    expect(await counts()).toEqual({ uploads: 0, chunks: 0, jobs: 0 });
  });

  it("rolls back on stored byte overflow", async () => {
    await expect(receiveUpload(pool, input(randomBytes(100)), "identity", null, { ...limits, maxStoredBytes: 10 }, new AbortController().signal)).rejects.toMatchObject({ code: "stored_limit" });
    expect(await counts()).toEqual({ uploads: 0, chunks: 0, jobs: 0 });
  });

  it("accepts empty opaque input for worker validation", async () => {
    const { uploadId } = await receiveUpload(pool, input(), "gzip", null, limits, new AbortController().signal);
    expect(await archive(uploadId)).toHaveLength(0);
    expect(await counts()).toEqual({ uploads: 1, chunks: 0, jobs: 1 });
  });

  it("cancels a stalled input and returns the connection", async () => {
    const controller = new AbortController();
    const stalled: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
    const pending = receiveUpload(pool, stalled, "gzip", null, limits, controller.signal);
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(await counts()).toEqual({ uploads: 0, chunks: 0, jobs: 0 });
  });

  it("times out input that never produces a chunk", async () => {
    const stalled: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
    await expect(receiveUpload(pool, stalled, "gzip", null, { ...limits, timeoutMs: 30 }, new AbortController().signal)).rejects.toMatchObject({ code: "timeout" });
    expect(await counts()).toEqual({ uploads: 0, chunks: 0, jobs: 0 });
  });

  it("attempts stalled input cleanup after timeout and leaves no rows", async () => {
    let cleanupCalled = false;
    let releaseNext: ((result: IteratorResult<Uint8Array>) => void) | undefined;
    const stalled: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise((resolve) => { releaseNext = resolve; }),
        return: () => {
          cleanupCalled = true;
          releaseNext?.({ done: true, value: undefined });
          return Promise.reject(new Error("cleanup failed"));
        },
      }),
    };
    await expect(receiveUpload(pool, stalled, "gzip", null, { ...limits, timeoutMs: 30 }, new AbortController().signal)).rejects.toMatchObject({ code: "timeout" });
    expect(cleanupCalled).toBe(true);
    expect(await counts()).toEqual({ uploads: 0, chunks: 0, jobs: 0 });
  });

  it("counts only queued and processing upload jobs against the queue cap", async () => {
    const first = await receiveUpload(pool, input(Buffer.from("a")), "gzip", null, limits, new AbortController().signal);
    await receiveUpload(pool, input(Buffer.from("b")), "gzip", null, limits, new AbortController().signal);
    expect(await uploadQueueFull(pool, 2)).toBe(true);
    expect(await uploadQueueFull(pool, 3)).toBe(false);
    await pool.query("UPDATE scan_jobs SET state = 'processing' WHERE upload_id = $1", [first.uploadId]);
    expect(await uploadQueueFull(pool, 2)).toBe(true);
    await pool.query("UPDATE scan_jobs SET state = 'failed' WHERE upload_id = $1", [first.uploadId]);
    expect(await uploadQueueFull(pool, 2)).toBe(false);
  });

  it("rejects a finished reception when the upload queue is full and rolls it back", async () => {
    await receiveUpload(pool, input(Buffer.from("queued")), "gzip", null, limits, new AbortController().signal);
    await expect(receiveUpload(pool, input(Buffer.from("late")), "gzip", null, { ...limits, maxQueuedUploads: 1 }, new AbortController().signal))
      .rejects.toMatchObject({ code: "queue_full" });
    expect(await counts()).toEqual({ uploads: 1, chunks: 1, jobs: 1 });
  });

  it("lets exactly one of two receivers racing for the final queue slot commit", async () => {
    await receiveUpload(pool, input(Buffer.from("queued")), "gzip", null, limits, new AbortController().signal);
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock($1)", [UPLOAD_QUEUE_LOCK_KEY]);
    const capped = { ...limits, maxQueuedUploads: 2 };
    const racers = [Buffer.from("left"), Buffer.from("right")].map((bytes) =>
      receiveUpload(pool, input(bytes), "gzip", null, capped, new AbortController().signal).then(() => "committed", (error) => error.code));
    try {
      await vi.waitFor(async () => {
        const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE 'SELECT pg_advisory_xact_lock%' AND datname = current_database() AND pid <> $1`, [(blocker as unknown as { processID: number }).processID]);
        expect(rows[0].n).toBe(2);
      }, { timeout: 10_000 });
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    expect((await Promise.all(racers)).sort()).toEqual(["committed", "queue_full"]);
    expect(await counts()).toEqual({ uploads: 2, chunks: 2, jobs: 2 });
  });

  it("rolls back cancellation while an insert waits on a database lock", async () => {
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE scan_artifact_chunks IN ACCESS EXCLUSIVE MODE");
    const controller = new AbortController();
    const pending = receiveUpload(pool, input(Buffer.from("body")), "gzip", null, limits, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ code: "aborted" });
    try {
      await vi.waitFor(async () => {
        const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE 'INSERT INTO scan_artifact_chunks%'`);
        expect(rows[0].n).toBeGreaterThan(0);
      }, { timeout: 10_000 });
      controller.abort();
      await assertion;
    } finally { controller.abort(); await blocker.query("ROLLBACK"); blocker.release(); }
    expect(await counts()).toEqual({ uploads: 0, chunks: 0, jobs: 0 });
  });
});
