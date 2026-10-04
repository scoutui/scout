import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_VERSION } from "@scoutui/scan-format";
import { GET as whoami } from "@/app/api/auth/cli/whoami/route";
import { POST as upload } from "@/app/api/scans/route";
import { POST as preflight } from "@/app/api/scans/preflight/route";
import { GET as uploadStatus } from "@/app/api/scans/uploads/[uploadId]/route";
import { getPool } from "@/db/client";
import { type Role, UPLOAD_REFUSAL } from "@/lib/access";
import { consumeApprovedDeviceCode } from "@/lib/cli-session-store";
import { hashToken } from "@/lib/cli-session-tokens";
import { resetRateLimitState } from "@/lib/rate-limit";
import { insertPerson } from "../helpers/people";
import { openReadModelDatabase } from "../helpers/read-model-db";
import { receiveArtifact, sampleArtifact } from "../helpers/scan-artifact";

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => session.current) }));

// biome-ignore lint/complexity/useLiteralKeys: env access
const RUN_DB = process.env["DATABASE_URL"] != null;
const CI_SECRET = "ci-secret-1234";

const check = {
  repoId: "acme/web", remote: null, scanner: "@scoutui/cli", scannerVersion: "0.10.0", schemaVersion: SCHEMA_VERSION, rescan: false,
  commits: ["a1c9e04d2f", "0b5d7e1f3a"],
};

function post(path: string, bearer: string | null, body: BodyInit) {
  return new Request(`http://x${path}`, {
    method: "POST", headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), "Content-Type": "application/json" }, body, duplex: "half",
  } as RequestInit);
}

function get(path: string, bearer: string | null) {
  return new Request(`http://x${path}`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
}

/** A request body that records whether anything asked for its bytes. */
function watchedBody(text: string) {
  const chunks = [new TextEncoder().encode(text)];
  const read = { pulled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      read.pulled = true;
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  }, { highWaterMark: 0 });
  return { read, stream };
}

describe.skipIf(!RUN_DB)("who may upload scans, against PostgreSQL", () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;

  async function cliToken(userId: string): Promise<string> {
    const deviceId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO cli_device_codes (id, device_code_hash, user_code, status, approved_user_id, expires_at) VALUES ($1, $2, $3, 'approved', $4, now() + interval '10 minutes')",
      [deviceId, hashToken(`device-${deviceId}`), `code-${deviceId}`, userId],
    );
    return (await consumeApprovedDeviceCode(deviceId, userId))?.token ?? "";
  }

  async function bearer(who: Role | "ci"): Promise<string> {
    if (who === "ci") return CI_SECRET;
    return cliToken(await insertPerson(pool, { email: `${who}@example.com`, role: who }));
  }

  async function storedUploads(): Promise<number> {
    return (await pool.query("SELECT count(*)::int AS n FROM scan_uploads")).rows[0].n;
  }

  beforeAll(async () => {
    database = openReadModelDatabase();
    pool = await database.pool;
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
  });

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
    vi.stubEnv("SCOUTUI_ADMINS", undefined);
    vi.stubEnv("SCOUTUI_ADMIN_GROUP", undefined);
    vi.stubEnv("SCOUTUI_CI_UPLOAD_TOKEN", CI_SECRET);
    session.current = null;
    resetRateLimitState();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await pool.query('TRUNCATE repos, scan_uploads, cli_device_codes, "user" CASCADE');
  });

  afterAll(async () => {
    await getPool().end();
    vi.unstubAllEnvs();
    await database.close();
  });

  it.each([
    { who: "a Viewer", as: "viewer" as const, status: 403, refusal: UPLOAD_REFUSAL, pulled: false, stored: 0 },
    { who: "an Editor", as: "editor" as const, status: 202, refusal: undefined, pulled: true, stored: 1 },
    { who: "the CI upload secret", as: "ci" as const, status: 202, refusal: undefined, pulled: true, stored: 1 },
  ])("answers an upload from $who with $status, and reads its body: $pulled", async ({ as, status, refusal, pulled, stored }) => {
    const body = watchedBody("{}");
    const response = await upload(post("/api/scans", await bearer(as), body.stream));
    expect(response.status).toBe(status);
    expect((await response.json()).refusal).toEqual(refusal);
    expect(body.read.pulled).toBe(pulled);
    expect(await storedUploads()).toBe(stored);
  });

  it("answers a Viewer's pre-scan check with the upload refusal without reading the body, and an Editor's with one answer per commit", async () => {
    const viewerBody = watchedBody(JSON.stringify(check));
    const refused = await preflight(post("/api/scans/preflight", await bearer("viewer"), viewerBody.stream));
    expect(refused.status).toBe(200);
    const refusedBody = await refused.json();
    expect(refusedBody.refusal).toEqual(UPLOAD_REFUSAL);
    expect(refusedBody.commits).toEqual([]);
    expect(viewerBody.read.pulled).toBe(false);

    const answered = await preflight(post("/api/scans/preflight", await bearer("editor"), JSON.stringify(check)));
    expect(answered.status).toBe(200);
    const answeredBody = await answered.json();
    expect(answeredBody.refusal).toBeNull();
    expect(answeredBody.commits).toEqual([
      { commit: "a1c9e04d2f", decision: "upload" },
      { commit: "0b5d7e1f3a", decision: "upload" },
    ]);
  });

  it("stops taking uploads from a removed person's CLI token", async () => {
    const id = await insertPerson(pool, { email: "ana@example.com", role: "editor" });
    const token = await cliToken(id);
    expect((await upload(post("/api/scans", token, "{}"))).status).toBe(202);
    await pool.query('UPDATE "user" SET role = NULL WHERE id = $1', [id]);
    expect((await upload(post("/api/scans", token, "{}"))).status).toBe(401);
  });

  it("refuses an upload and a pre-scan check that bring only an Editor's browser session, which can still read an upload's status", async () => {
    session.current = { user: { id: await insertPerson(pool, { email: "ana@example.com", role: "editor" }) } };
    const uploadId = await receiveArtifact(pool, sampleArtifact());
    expect((await upload(post("/api/scans", null, "{}"))).status).toBe(401);
    expect((await preflight(post("/api/scans/preflight", null, JSON.stringify(check)))).status).toBe(401);
    expect((await uploadStatus(get(`/api/scans/uploads/${uploadId}`, null), { params: Promise.resolve({ uploadId }) })).status).toBe(200);
  });

  it("shows an upload's status to a Viewer and the CI upload secret, and to nobody without credentials", async () => {
    const uploadId = await receiveArtifact(pool, sampleArtifact());
    const statusOf = async (token: string | null) =>
      (await uploadStatus(get(`/api/scans/uploads/${uploadId}`, token), { params: Promise.resolve({ uploadId }) })).status;
    expect(await statusOf(await bearer("viewer"))).toBe(200);
    expect(await statusOf(CI_SECRET)).toBe(200);
    expect(await statusOf(null)).toBe(401);
  });

  it("tells the CLI a Viewer's role, and Admin for a verified email in SCOUTUI_ADMINS", async () => {
    vi.stubEnv("SCOUTUI_ADMINS", "ana@example.com");
    const viewer = await insertPerson(pool, { email: "bo@example.com" });
    const admin = await insertPerson(pool, { email: "ana@example.com", verified: true });
    const me = async (userId: string) => (await whoami(get("/api/auth/cli/whoami", await cliToken(userId)))).json();
    expect(await me(viewer)).toEqual({ userId: viewer, email: "bo@example.com", role: "viewer" });
    expect(await me(admin)).toEqual({ userId: admin, email: "ana@example.com", role: "admin" });
  });
});
