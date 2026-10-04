import { randomBytes } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import { DrizzleQueryError } from "drizzle-orm/errors";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readArchive } from "@/lib/scan-archive";
import type { Identity } from "@/lib/access";
import { identify } from "@/lib/identity";
import { hashToken } from "@/lib/cli-session-tokens";
import { claimScanJob, UPLOAD_QUEUE_LOCK_KEY, type ClaimedScanJob } from "@/lib/scan-jobs";
import { publishScan } from "@/lib/scan-projection";
import { processScanJob } from "@/worker/runner";
import { openReadModelDatabase } from "../helpers/read-model-db";
import { sampleArtifact } from "../helpers/scan-artifact";

const zlib = vi.hoisted(() => ({ syncCalls: [] as string[] }));
vi.mock("node:zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:zlib")>();
  const spied = Object.fromEntries(Object.entries(actual).map(([name, value]) =>
    [name, typeof value === "function" && name.endsWith("Sync")
      ? (...args: unknown[]) => { zlib.syncCalls.push(name); return (value as (...a: unknown[]) => unknown)(...args); }
      : value]));
  return { ...spied, default: spied };
});
const projector = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/scan-projection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scan-projection")>();
  return {
    ...actual,
    publishScan: (...args: Parameters<typeof actual.publishScan>) => { projector.calls++; return actual.publishScan(...args); },
    publishScanSource: (...args: Parameters<typeof actual.publishScanSource>) => { projector.calls++; return actual.publishScanSource(...args); },
    republishScan: (...args: Parameters<typeof actual.republishScan>) => { projector.calls++; return actual.republishScan(...args); },
  };
});
const db = vi.hoisted(() => ({ pool: undefined as Pool | undefined }));
vi.mock("@/db/client", () => ({ getPool: () => db.pool }));
const identity = vi.hoisted(() => ({ value: null as Identity | null }));
vi.mock("@/lib/identity", () => ({ identify: vi.fn(async () => identity.value) }));

import { POST } from "@/app/api/scans/route";
import { GET } from "@/app/api/scans/uploads/[uploadId]/route";

const editor: Identity = { kind: "person", userId: "u1", email: "u1@example.test", name: null, role: "editor", roleSource: "people" };

function request(body: BodyInit | null, headers: Record<string, string> = {}, signal?: AbortSignal, url = "http://x/api/scans") {
  return new Request(url, {
    method: "POST", headers: { Authorization: "Bearer token", ...headers }, body, signal, duplex: "half",
  } as RequestInit);
}

function source(chunks: Uint8Array[], then: "close" | "stall" | "error" = "close") {
  const events = { pulls: 0, cancelled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      events.pulls++;
      const chunk = chunks.shift();
      if (chunk) return controller.enqueue(chunk);
      if (then === "close") return controller.close();
      if (then === "error") return controller.error(new Error("client disconnected"));
      return new Promise<void>(() => {});
    },
    cancel() { events.cancelled++; },
  }, { highWaterMark: 0 });
  return { stream, events };
}

async function statusOf(statusUrl: string) {
  const uploadId = statusUrl.split("/").at(-1) as string;
  const response = await GET(new Request(`http://x${statusUrl}`, { headers: { Authorization: "Bearer token" } }), {
    params: Promise.resolve({ uploadId }),
  });
  return response.json();
}

const { DATABASE_URL: databaseUrl } = process.env;

describe("POST /api/scans without reception", () => {
  beforeEach(() => { identity.value = editor; db.pool = undefined; });
  afterEach(() => vi.restoreAllMocks());

  it("returns a generic server error when CLI bearer lookup fails", async () => {
    const raw = `scout_u_${"a".repeat(43)}`;
    const hash = hashToken(raw);
    vi.mocked(identify).mockRejectedValueOnce(new DrizzleQueryError("resolve upload bearer", [hash], new Error(raw)));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(request(null, { Authorization: `Bearer ${raw}` }));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe('{"error":"server_error"}');
    expect(body).not.toContain(raw);
    expect(body).not.toContain(hash);
    expect(logged).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated uploads without reading the body", async () => {
    identity.value = null;
    const body = source([Buffer.from("{}")]);
    const res = await POST(request(body.stream, { Authorization: "" }));
    expect(res.status).toBe(401);
    expect(body.events.pulls).toBe(0);
  });

  it("rejects an unsupported encoding without reading the body", async () => {
    const body = source([Buffer.from("{}")]);
    const res = await POST(request(body.stream, { "Content-Encoding": "br" }));
    expect(res.status).toBe(415);
    expect(body.events.pulls).toBe(0);
  });

  it("rejects a declared length over the limit without reading the body", async () => {
    const body = source([Buffer.from("{}")]);
    const res = await POST(request(body.stream, { "Content-Length": String(42 * 1024 * 1024 + 1) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload too large (limit 42 MiB)" });
    expect(body.events.pulls).toBe(0);
  });
});

describe.skipIf(!databaseUrl)("POST /api/scans reception", { timeout: 30_000 }, () => {
  const database = databaseUrl ? openReadModelDatabase() : undefined;
  let pool: Pool;
  beforeAll(async () => { pool = await (database as NonNullable<typeof database>).pool; }, 30_000);
  afterAll(async () => { await database?.close(); }, 30_000);
  beforeEach(async () => {
    db.pool = pool;
    identity.value = editor;
    projector.calls = 0;
    zlib.syncCalls.length = 0;
    await pool.query("TRUNCATE repos, scan_uploads, \"user\" CASCADE");
    await pool.query("INSERT INTO \"user\" (id, email) VALUES ('u1', 'u1@example.test')");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

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

  it("stores a gzip body unchanged and returns a receipt without decoding or publishing it", async () => {
    const bytes = randomBytes(64 * 1024);
    const parse = vi.spyOn(JSON, "parse");
    const response = await POST(request(bytes, { "Content-Encoding": "gzip", "Content-Type": "application/json" }));
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
    expect(response.status).toBe(202);
    const receipt = await response.json();
    const { uploadId } = receipt;
    expect(receipt).toEqual({ uploadId, statusUrl: expect.any(String) });
    expect(receipt.statusUrl).toBe(`/api/scans/uploads/${uploadId}`);
    expect(response.headers.get("Location")).toBe(receipt.statusUrl);
    expect(await archive(uploadId)).toEqual(bytes);
    expect(projector.calls).toBe(0);
    expect(zlib.syncCalls).toEqual([]);
    expect((await pool.query("SELECT state, uploaded_by_user_id FROM scan_uploads")).rows).toEqual([{ state: "queued", uploaded_by_user_id: "u1" }]);
    expect(await statusOf(receipt.statusUrl)).toMatchObject({ state: "queued", readable: false });
  });

  it("accepts identity bodies that are not JSON and stores them compressed", async () => {
    const text = Buffer.from("{ this is not json");
    const parse = vi.spyOn(JSON, "parse");
    const response = await POST(request(text));
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
    expect(response.status).toBe(202);
    const { uploadId } = await response.json();
    const { gunzipSync } = await vi.importActual<typeof import("node:zlib")>("node:zlib");
    expect(gunzipSync(await archive(uploadId))).toEqual(text);
    expect(zlib.syncCalls).toEqual([]);
  });

  it("records a CI upload without a user", async () => {
    identity.value = { kind: "ci" };
    expect((await POST(request(Buffer.from("{}")))).status).toBe(202);
    expect((await pool.query("SELECT uploaded_by_user_id FROM scan_uploads")).rows).toEqual([{ uploaded_by_user_id: null }]);
  });

  it("carries the rescan flag onto the upload's job", async () => {
    await POST(request(Buffer.from("{}")));
    await POST(request(Buffer.from("{}"), {}, undefined, "http://x/api/scans?rescan=1"));
    expect((await pool.query("SELECT rescan FROM scan_jobs ORDER BY sequence")).rows).toEqual([{ rescan: false }, { rescan: true }]);
  });

  it("fails malformed gzip in the worker after accepting it", async () => {
    const response = await POST(request(Buffer.from("not gzip"), { "Content-Encoding": "gzip" }));
    expect(response.status).toBe(202);
    const { statusUrl } = await response.json();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await processScanJob(pool, await claimScanJob(pool, "route-test") as ClaimedScanJob, new AbortController().signal);
    expect(await statusOf(statusUrl)).toEqual({
      state: "failed", readable: false, error: { code: "invalid_gzip", message: "Couldn't upload the scan: it arrived damaged. Try again." },
    });
  });

  it("fails a scan that doesn't name the CLI that made it when the worker reads it, before publishing anything", async () => {
    const scan = sampleArtifact({ scannerName: null });
    const response = await POST(request(gzipSync(JSON.stringify(scan)), { "Content-Encoding": "gzip" }));
    expect(response.status).toBe(202);
    const { statusUrl } = await response.json();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await processScanJob(pool, await claimScanJob(pool, "route-test") as ClaimedScanJob, new AbortController().signal);
    expect(await statusOf(statusUrl)).toEqual({
      state: "failed", readable: false, error: {
        code: "unsupported_scanner",
        message: "Couldn't upload the scan: it comes from a CLI this dashboard no longer accepts. Install @scoutui/cli and scan again.",
      },
    });
    expect(projector.calls).toBe(0);
    expect((await pool.query("SELECT scan_id FROM scans")).rows).toEqual([]);
  });

  it("replaces a commit's scan that names no CLI with a rescan from an earlier version of a named CLI", async () => {
    const unnamed = sampleArtifact({ scanId: "unnamed", commit: "a1c9e04d2f", scannerName: null });
    unnamed.meta.scannerVersion = "0.1.29";
    await publishScan(pool, unnamed, { uploadedByUserId: null });
    const rescan = sampleArtifact({ scanId: "named", commit: "a1c9e04d2f" });
    rescan.meta.scannerVersion = "0.1.0";
    const response = await POST(request(gzipSync(JSON.stringify(rescan)), { "Content-Encoding": "gzip" }, undefined, "http://x/api/scans?rescan=1"));
    const { statusUrl } = await response.json();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await processScanJob(pool, await claimScanJob(pool, "route-test") as ClaimedScanJob, new AbortController().signal);
    expect(await statusOf(statusUrl)).toMatchObject({ state: "ready", readable: true, scanId: "named", replaced: true });
    expect((await pool.query("SELECT scan_id, scanner, scanner_version FROM scans")).rows)
      .toEqual([{ scan_id: "named", scanner: "@scoutui/cli", scanner_version: "0.1.0" }]);
  });

  it("receives a streamed body without a declared length", async () => {
    const body = source([Buffer.from("{\"a\":"), Buffer.from("1}")]);
    const response = await POST(request(body.stream));
    expect(response.status).toBe(202);
    expect(body.events.pulls).toBeGreaterThanOrEqual(3);
  });

  it("enforces the wire limit on bytes received, not the declared length, and cancels the body", async () => {
    vi.stubEnv("SCOUTUI_MAX_UPLOAD_BYTES", "4096");
    vi.stubEnv("SCOUTUI_MAX_STORED_UPLOAD_BYTES", "8192");
    const body = source([randomBytes(3000), randomBytes(3000), randomBytes(3000)]);
    const response = await POST(request(body.stream, { "Content-Length": "10" }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload too large (limit 4096 bytes)" });
    expect(body.events.cancelled).toBe(1);
    expect(await counts()).toEqual({ uploads: 0, chunks: 0, jobs: 0 });
  });

  it("enforces the stored limit on compressed bytes", async () => {
    vi.stubEnv("SCOUTUI_MAX_STORED_UPLOAD_BYTES", "1024");
    const response = await POST(request(randomBytes(4096)));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "stored upload too large (limit 1024 bytes)" });
    expect(await counts()).toEqual({ uploads: 0, chunks: 0, jobs: 0 });
  });

  it("times out a body that stalls mid-read, cancels its reader and frees the slot", async () => {
    vi.stubEnv("SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS", "100");
    const body = source([Buffer.from("partial")], "stall");
    const response = await POST(request(body.stream));
    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await response.json()).toEqual({ error: "scan upload timed out; retry later" });
    expect(body.events.cancelled).toBe(1);
    expect(await counts()).toEqual({ uploads: 0, chunks: 0, jobs: 0 });
    vi.unstubAllEnvs();
    expect((await POST(request(Buffer.from("{}")))).status).toBe(202);
  });

  it("rolls back when the client aborts mid-read, cancels its reader and frees the slot", async () => {
    const abort = new AbortController();
    const body = source([Buffer.from("partial")], "stall");
    const pending = POST(request(body.stream, {}, abort.signal));
    await vi.waitFor(() => expect(body.events.pulls).toBe(2), { timeout: 10_000 });
    abort.abort();
    expect((await pending).status).toBe(499);
    expect(body.events.cancelled).toBe(1);
    expect(await counts()).toEqual({ uploads: 0, chunks: 0, jobs: 0 });
    expect((await POST(request(Buffer.from("{}")))).status).toBe(202);
  });

  it("rolls back when the body fails mid-read and frees the slot", async () => {
    const body = source([Buffer.from("partial")], "error");
    const response = await POST(request(body.stream));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid request body" });
    expect(await counts()).toEqual({ uploads: 0, chunks: 0, jobs: 0 });
    expect((await POST(request(Buffer.from("{}")))).status).toBe(202);
  });

  it("rejects a full upload queue before reading the body", async () => {
    vi.stubEnv("SCOUTUI_MAX_QUEUED_UPLOADS", "1");
    expect((await POST(request(Buffer.from("{}")))).status).toBe(202);
    const body = source([Buffer.from("{}")]);
    const response = await POST(request(body.stream));
    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await response.json()).toEqual({ error: "scan upload queue is full; retry later" });
    expect(body.events.pulls).toBe(0);
    expect(await counts()).toMatchObject({ uploads: 1, jobs: 1 });
  });

  it("accepts one of two uploads racing for the final queue slot and rolls back the other", async () => {
    vi.stubEnv("SCOUTUI_MAX_QUEUED_UPLOADS", "2");
    vi.stubEnv("SCOUTUI_UPLOAD_RECEIVE_SLOTS", "2");
    expect((await POST(request(Buffer.from("{}")))).status).toBe(202);
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock($1)", [UPLOAD_QUEUE_LOCK_KEY]);
    const racers = [POST(request(Buffer.from("{\"left\":1}"))), POST(request(Buffer.from("{\"right\":1}")))];
    try {
      await vi.waitFor(async () => {
        const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE 'SELECT pg_advisory_xact_lock%' AND datname = current_database()`);
        expect(rows[0].n).toBe(2);
      }, { timeout: 10_000 });
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    const responses = await Promise.all(racers);
    expect(responses.map((response) => response.status).sort()).toEqual([202, 503]);
    const rejected = responses.find((response) => response.status === 503);
    expect(Number(rejected?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await rejected?.json()).toEqual({ error: "scan upload queue is full; retry later" });
    expect(await counts()).toMatchObject({ uploads: 2, jobs: 2 });
  });

  it("returns a fixed 500 body and logs only the failure class when the database fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    db.pool = { connect: async () => { throw Object.assign(new Error("password authentication failed for secret-user"), { code: "28P01" }); } } as unknown as Pool;
    const response = await POST(request(Buffer.from("{}")));
    await setImmediate();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "upload failed" });
    expect(error).toHaveBeenCalledWith("[scans] upload failed: 28P01");
  });
});
