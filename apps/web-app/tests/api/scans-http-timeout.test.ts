import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { openReadModelDatabase } from "../helpers/read-model-db";

const db = vi.hoisted(() => ({ pool: undefined as Pool | undefined }));
vi.mock("@/db/client", () => ({ getPool: () => db.pool }));
vi.mock("@/lib/identity", () => ({ identify: vi.fn(async () => ({ kind: "ci" })) }));

import { POST } from "@/app/api/scans/route";

async function handle(req: IncomingMessage, res: ServerResponse) {
  const abort = new AbortController();
  res.on("close", () => { if (!res.writableFinished) abort.abort(); });
  const response = await POST(new Request(`http://127.0.0.1${req.url}`, {
    method: req.method, headers: req.headers as Record<string, string>, signal: abort.signal, duplex: "half",
    body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
  } as RequestInit));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function listen(requestTimeout: number): Promise<Server> {
  const server = createServer({ requestTimeout, connectionsCheckingInterval: 50 }, (req, res) => { void handle(req, res); });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function stalledUpload(server: Server): Promise<{ status: number; retryAfter: string | undefined }> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: "/api/scans", method: "POST", headers: { Authorization: "Bearer ci", "Content-Type": "application/json" } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, retryAfter: res.headers["retry-after"] as string | undefined });
      req.destroy();
    });
    req.on("error", reject);
    req.write("{\"partial\":");
  });
}

const { DATABASE_URL: databaseUrl } = process.env;

describe.skipIf(!databaseUrl)("POST /api/scans on a Node HTTP server", { timeout: 30_000 }, () => {
  const database = databaseUrl ? openReadModelDatabase() : undefined;
  let server: Server | undefined;
  beforeAll(async () => { db.pool = await (database as NonNullable<typeof database>).pool; }, 30_000);
  afterAll(async () => { await database?.close(); }, 30_000);
  afterEach(async () => {
    vi.unstubAllEnvs();
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
  });

  it("answers a stalled body with the retryable timeout before the server's request timeout", async () => {
    vi.stubEnv("SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS", "300");
    server = await listen(1_500);
    expect(await stalledUpload(server)).toEqual({ status: 503, retryAfter: "60" });
    expect((await (db.pool as Pool).query("SELECT count(*)::int AS n FROM scan_uploads")).rows[0].n).toBe(0);
  });

  it("loses the stalled body to the server's 408 when the receive timeout outlasts it", async () => {
    vi.stubEnv("SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS", "5000");
    server = await listen(300);
    expect((await stalledUpload(server)).status).toBe(408);
  });
});
