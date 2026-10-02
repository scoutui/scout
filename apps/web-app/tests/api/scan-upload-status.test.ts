import { gzipSync } from "node:zlib";
import { DrizzleQueryError } from "drizzle-orm/errors";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { claimScanJob, type ClaimedScanJob } from "@/lib/scan-jobs";
import { processScanJob } from "@/worker/runner";
import { openReadModelDatabase } from "../helpers/read-model-db";
import { receiveArtifact, sampleArtifact } from "../helpers/scan-artifact";
import { verifyUploadBearer } from "@/lib/auth";
import { hashToken } from "@/lib/cli-session-tokens";

const db = vi.hoisted(() => ({ pool: undefined as Pool | undefined }));
const session = vi.hoisted(() => ({ value: null as null | { user?: { id?: string } } }));
vi.mock("@/db/client", () => ({ getPool: () => db.pool }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => session.value) }));
vi.mock("@/lib/auth", () => ({
  verifyUploadBearer: vi.fn(async (header: string | null) => {
    if (header === "Bearer user-token") return { kind: "user", userId: "u1" };
    if (header === "Bearer ci-token") return { kind: "ci" };
    return null;
  }),
}));

import { GET } from "@/app/api/scans/uploads/[uploadId]/route";

function status(uploadId: string, authorization: string | null = "Bearer user-token") {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  return GET(new Request(`http://x/api/scans/uploads/${encodeURIComponent(uploadId)}`, { headers }), {
    params: Promise.resolve({ uploadId }),
  });
}

async function statusBody(uploadId: string) {
  const response = await status(uploadId);
  expect(response.status).toBe(200);
  return response.json();
}

async function processNext(pool: Pool) {
  await processScanJob(pool, await claimScanJob(pool, "status-test") as ClaimedScanJob, new AbortController().signal);
}

function holdCommitAfter(pool: Pool, marker: string) {
  let open = () => {};
  const opened = new Promise<void>((resolve) => { open = resolve; });
  let held = false;
  const state = { reached: false };
  const gated = new Proxy(pool, {
    get(target, key) {
      if (key === "connect") {
        return async () => {
          const client = await target.connect();
          let marked = false;
          return new Proxy(client, {
            get(object, property) {
              if (property === "query") {
                return async (query: unknown, values?: unknown[]) => {
                  if (typeof query === "string" && query.includes(marker)) marked = true;
                  if (query === "COMMIT" && marked && !held) {
                    held = true;
                    state.reached = true;
                    await opened;
                  }
                  return object.query(query as string, values);
                };
              }
              const value = Reflect.get(object, property);
              return typeof value === "function" ? value.bind(object) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { pool: gated, state, open };
}

const { DATABASE_URL: databaseUrl } = process.env;

describe("GET /api/scans/uploads/[uploadId] database failures", () => {
  afterEach(() => { vi.restoreAllMocks(); db.pool = undefined; });

  it("returns a generic server error when CLI bearer lookup fails", async () => {
    const raw = `scout_u_${"a".repeat(43)}`;
    const hash = hashToken(raw);
    vi.mocked(verifyUploadBearer).mockRejectedValueOnce(new DrizzleQueryError("resolve upload bearer", [hash], new Error(raw)));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await status("00000000-0000-4000-8000-000000000000", `Bearer ${raw}`);
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe('{"error":"server_error"}');
    expect(body).not.toContain(raw);
    expect(body).not.toContain(hash);
    expect(logged).not.toHaveBeenCalled();
  });

  it("asks the client to retry without exposing the database error", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = Object.assign(new Error('relation "scan_uploads" does not exist at SELECT receipt.state FROM scan_uploads'), { code: "42P01" });
    db.pool = { query: async () => { throw failure; } } as unknown as Pool;
    const response = await status("00000000-0000-4000-8000-000000000000");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "upload status unavailable; retry later" });
    expect(body).not.toMatch(/scan_uploads|SELECT|42P01/);
    expect(errors.mock.calls).toEqual([["[scans] upload status failed: 42P01"]]);
  });
});

describe.skipIf(!databaseUrl)("GET /api/scans/uploads/[uploadId]", { timeout: 30_000 }, () => {
  const database = databaseUrl ? openReadModelDatabase() : undefined;
  let pool: Pool;
  beforeAll(async () => { pool = await (database as NonNullable<typeof database>).pool; db.pool = pool; }, 30_000);
  afterAll(async () => { await database?.close(); }, 30_000);
  afterEach(() => { vi.restoreAllMocks(); });
  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    session.value = null;
    await pool.query("TRUNCATE repos, scan_uploads CASCADE");
  });

  it("requires an upload bearer or a signed-in session", async () => {
    const uploadId = await receiveArtifact(pool, sampleArtifact());
    const anonymous = await status(uploadId, null);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthorized" });
    expect((await status(uploadId, "Bearer expired")).status).toBe(401);
    session.value = { user: {} };
    expect((await status(uploadId, null)).status).toBe(401);
  });

  it("accepts a user bearer, the CI bearer and a browser session", async () => {
    const uploadId = await receiveArtifact(pool, sampleArtifact());
    expect((await status(uploadId, "Bearer user-token")).status).toBe(200);
    expect((await status(uploadId, "Bearer ci-token")).status).toBe(200);
    session.value = { user: { id: "u2" } };
    const browser = await status(uploadId, null);
    expect(browser.status).toBe(200);
    expect(browser.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not find unknown or still-receiving uploads", async () => {
    const unknown = await status("00000000-0000-4000-8000-000000000000");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "upload not found" });
    await pool.query("INSERT INTO scan_uploads (upload_id, encoding) VALUES ('receiving-upload', 'gzip')");
    expect((await status("receiving-upload")).status).toBe(404);
  });

  it("reports a queued upload with a poll hint", async () => {
    const uploadId = await receiveArtifact(pool, sampleArtifact());
    expect(await statusBody(uploadId)).toEqual({ state: "queued", readable: false, stage: "queued", retryAfterSeconds: 2 });
  });

  it("stays unreadable until the publication commits, then reports the scan", async () => {
    const uploadId = await receiveArtifact(pool, sampleArtifact());
    const gate = holdCommitAfter(pool, "INSERT INTO scan_read_models");
    const processing = processNext(gate.pool);
    await vi.waitFor(() => expect(gate.state.reached).toBe(true), { timeout: 10_000 });
    expect(await statusBody(uploadId)).toEqual({ state: "processing", readable: false, stage: "publishing", retryAfterSeconds: 2 });
    gate.open();
    await processing;
    expect(await statusBody(uploadId)).toEqual({ state: "ready", readable: true, scanId: "scan-a", url: "/repos/repo-a" });
  });

  it("keeps a duplicate unreadable while its canonical scan's models are rebuilt", async () => {
    const first = await receiveArtifact(pool, sampleArtifact({ repoId: "org/repo-a" }));
    await processNext(pool);
    await pool.query("DELETE FROM scan_read_models");
    expect(await statusBody(first)).toEqual({
      state: "ready", readable: false, scanId: "scan-a", url: "/repos/org%2Frepo-a", stage: "preparing", retryAfterSeconds: 2,
    });

    const duplicate = await receiveArtifact(pool, sampleArtifact({ repoId: "org/repo-a" }));
    const gate = holdCommitAfter(pool, "INSERT INTO scan_read_models");
    const processing = processNext(gate.pool);
    await vi.waitFor(() => expect(gate.state.reached).toBe(true), { timeout: 10_000 });
    expect(await statusBody(duplicate)).toMatchObject({ state: "processing", readable: false });
    gate.open();
    await processing;
    expect(await statusBody(duplicate)).toEqual({ state: "duplicate", readable: true, scanId: "scan-a", url: "/repos/org%2Frepo-a" });

    await pool.query("DELETE FROM scan_read_models");
    expect(await statusBody(duplicate)).toEqual({
      state: "duplicate", readable: false, scanId: "scan-a", url: "/repos/org%2Frepo-a", stage: "preparing", retryAfterSeconds: 2,
    });
  });

  it("reports a failed upload with only its stable error", async () => {
    const uploadId = await receiveArtifact(pool, gzipSync("{\"meta\":"));
    await processNext(pool);
    const response = await status(uploadId);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      state: "failed", readable: false, error: { code: "invalid_json", message: "Couldn't upload the scan: it arrived damaged. Try again." },
    });
    expect(text).not.toContain("meta");
  });

  it("does not expose a transient processing error while a retry is pending", async () => {
    const uploadId = await receiveArtifact(pool, sampleArtifact());
    await pool.query(`UPDATE scan_jobs SET error_code = 'processing_error', error_message = 'Scan processing failed',
      available_at = now() + interval '30 seconds'`);
    expect(await statusBody(uploadId)).toEqual({ state: "queued", readable: false, stage: "queued", retryAfterSeconds: 30 });
  });
});
