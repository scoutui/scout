import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { consumeApprovedDeviceCode, resolveCliSession, revokeCliSession } from "@/lib/cli-session-store";
import { deleteDeniedDeviceCode, findByDeviceCodeHash, markApproved, markDenied, pruneDeviceCodes } from "@/lib/cli-device-codes";
import { hashToken } from "@/lib/cli-session-tokens";
import { getPool } from "@/db/client";
import { openReadModelDatabase } from "../helpers/read-model-db";

// biome-ignore lint/complexity/useLiteralKeys: env access
const RUN_DB = process.env["DATABASE_URL"] != null;

describe.skipIf(!RUN_DB)("durable CLI sessions in PostgreSQL", () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  let userId: string;
  const deviceIds: string[] = [];

  async function approvedCode(): Promise<string> {
    const id = crypto.randomUUID();
    deviceIds.push(id);
    await pool.query(
      "INSERT INTO cli_device_codes (id, device_code_hash, user_code, status, approved_user_id, expires_at) VALUES ($1, $2, $3, 'approved', $4, now() + interval '10 minutes')",
      [id, hashToken(`device-${id}`), `code-${id}`, userId],
    );
    return id;
  }

  beforeAll(async () => {
    database = openReadModelDatabase();
    pool = await database.pool;
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
  });

  beforeEach(async () => {
    userId = crypto.randomUUID();
    await pool.query('INSERT INTO "user" (id, email) VALUES ($1, $2)', [userId, `${userId}@example.com`]);
  });

  afterEach(async () => {
    if (deviceIds.length > 0) {
      await pool.query("DELETE FROM cli_device_codes WHERE id = ANY($1)", [deviceIds]);
      deviceIds.length = 0;
    }
    await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
  });

  afterAll(async () => {
    await getPool().end();
    vi.unstubAllEnvs();
    await database.close();
  });

  it("issues exactly one credential under parallel consumption and retains it after one hour", async () => {
    const deviceId = await approvedCode();
    const results = await Promise.all([
      consumeApprovedDeviceCode(deviceId, userId),
      consumeApprovedDeviceCode(deviceId, userId),
    ]);
    const issued = results.filter((result): result is NonNullable<typeof result> => result !== null);
    expect(issued).toHaveLength(1);
    expect(issued[0]?.token).toMatch(/^scout_u_[A-Za-z0-9_-]{43}$/);
    expect(issued[0]?.email).toBe(`${userId}@example.com`);

    const { rows } = await pool.query("SELECT id, token_hash FROM cli_sessions WHERE user_id = $1", [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toBe(hashToken(issued[0]?.token ?? ""));
    expect(await resolveCliSession(issued[0]?.token ?? "")).toEqual({
      sessionId: rows[0]?.id, userId, email: `${userId}@example.com`,
    });

    await pool.query("UPDATE cli_sessions SET created_at = now() - interval '2 hours' WHERE id = $1", [rows[0]?.id]);
    expect(await resolveCliSession(issued[0]?.token ?? "")).toMatchObject({ userId });

    await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
    const afterDelete = await pool.query("SELECT id FROM cli_sessions WHERE user_id = $1", [userId]);
    expect(afterDelete.rows).toHaveLength(0);
    expect(await resolveCliSession(issued[0]?.token ?? "")).toBeNull();
  });

  it.each([
    { case: "signed in just now", signedInDaysAgo: 0, lastUsedDaysAgo: 0, accepted: true },
    { case: "unused for 29 days", signedInDaysAgo: 29, lastUsedDaysAgo: 29, accepted: true },
    { case: "unused for 31 days", signedInDaysAgo: 31, lastUsedDaysAgo: 31, accepted: false },
    { case: "signed in 89 days ago and used yesterday", signedInDaysAgo: 89, lastUsedDaysAgo: 1, accepted: true },
    { case: "signed in 91 days ago and used yesterday", signedInDaysAgo: 91, lastUsedDaysAgo: 1, accepted: false },
  ])("a session $case is accepted: $accepted", async ({ signedInDaysAgo, lastUsedDaysAgo, accepted }) => {
    const issued = await consumeApprovedDeviceCode(await approvedCode(), userId);
    const token = issued?.token ?? "";
    await pool.query(
      "UPDATE cli_sessions SET created_at = now() - make_interval(days => $2), last_used_at = now() - make_interval(days => $3) WHERE user_id = $1",
      [userId, signedInDaysAgo, lastUsedDaysAgo],
    );

    const resolved = await resolveCliSession(token);

    const { rows } = await pool.query(
      "SELECT last_used_at > now() - interval '1 minute' AS used_now FROM cli_sessions WHERE user_id = $1",
      [userId],
    );
    if (accepted) {
      expect(resolved).toMatchObject({ userId });
      expect(rows).toEqual([{ used_now: true }]);
    } else {
      expect(resolved).toBeNull();
      expect(rows).toEqual([]);
    }
  });

  it("revokes only the selected session for a user", async () => {
    const first = await consumeApprovedDeviceCode(await approvedCode(), userId);
    const second = await consumeApprovedDeviceCode(await approvedCode(), userId);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(await revokeCliSession(first?.token ?? "")).toBe(true);
    expect(await resolveCliSession(first?.token ?? "")).toBeNull();
    expect(await resolveCliSession(second?.token ?? "")).toMatchObject({ userId });
  });

  it("does not consume an approval that expires while its row is locked", async () => {
    const deviceId = await approvedCode();
    await pool.query("UPDATE cli_device_codes SET expires_at = now() + interval '1200 milliseconds' WHERE id = $1", [deviceId]);
    const lookedUp = await findByDeviceCodeHash(hashToken(`device-${deviceId}`));
    expect(lookedUp?.status).toBe("approved");
    expect(lookedUp?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const locker = await pool.connect();
    let locked = false;
    try {
      await locker.query("BEGIN");
      locked = true;
      await locker.query("SELECT id FROM cli_device_codes WHERE id = $1 FOR UPDATE", [deviceId]);
      const result = consumeApprovedDeviceCode(deviceId, userId);
      await new Promise((resolve) => setTimeout(resolve, 1600));
      await locker.query("COMMIT");
      locked = false;
      expect(await result).toBeNull();
      const sessions = await pool.query("SELECT id FROM cli_sessions WHERE user_id = $1", [userId]);
      expect(sessions.rows).toHaveLength(0);
      const code = await pool.query("SELECT status FROM cli_device_codes WHERE id = $1", [deviceId]);
      expect(code.rows[0]?.status).toBe("approved");
    } finally {
      if (locked) await locker.query("ROLLBACK");
      locker.release();
    }
  });

  it("rejects old JWT-shaped access and cc_r_ refresh tokens", async () => {
    expect(await resolveCliSession("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.signature")).toBeNull();
    expect(await resolveCliSession(`cc_r_${"a".repeat(43)}`)).toBeNull();
  });

  it("prunes expired and consumed codes while preserving unexpired denials until observed", async () => {
    const [expired, consumed, denied] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    deviceIds.push(expired, consumed, denied);
    for (const [id, status, expires] of [
      [expired, "pending", "now() - interval '1 minute'"],
      [consumed, "consumed", "now() + interval '10 minutes'"],
      [denied, "denied", "now() + interval '10 minutes'"],
    ]) {
      await pool.query(
        `INSERT INTO cli_device_codes (id, device_code_hash, user_code, status, expires_at) VALUES ($1, $2, $3, $4, ${expires})`,
        [id, hashToken(`device-${id}`), `code-${id}`, status],
      );
    }
    await pruneDeviceCodes();
    const afterPrune = await pool.query("SELECT id FROM cli_device_codes WHERE id = ANY($1)", [deviceIds]);
    expect(afterPrune.rows.map((row) => row.id)).toEqual([denied]);
    await pool.query("UPDATE cli_device_codes SET status = 'approved' WHERE id = $1", [denied]);
    await deleteDeniedDeviceCode(denied);
    const afterStatusChange = await pool.query("SELECT id FROM cli_device_codes WHERE id = $1", [denied]);
    expect(afterStatusChange.rows).toHaveLength(1);
    await pool.query("UPDATE cli_device_codes SET status = 'denied' WHERE id = $1", [denied]);
    await deleteDeniedDeviceCode(denied);
    const afterDenial = await pool.query("SELECT id FROM cli_device_codes WHERE id = $1", [denied]);
    expect(afterDenial.rows).toHaveLength(0);
  });

  it("denies only a still-pending and unexpired code", async () => {
    const cases = [
      { status: "pending", expired: false, accepted: true, finalStatus: "denied" },
      { status: "approved", expired: false, accepted: false, finalStatus: "approved" },
      { status: "consumed", expired: false, accepted: false, finalStatus: "consumed" },
      { status: "denied", expired: false, accepted: false, finalStatus: "denied" },
      { status: "pending", expired: true, accepted: false, finalStatus: "pending" },
    ] as const;

    for (const testCase of cases) {
      const id = crypto.randomUUID();
      const code = `code-${id}`;
      deviceIds.push(id);
      await pool.query(
        "INSERT INTO cli_device_codes (id, device_code_hash, user_code, status, expires_at) VALUES ($1, $2, $3, $4, $5)",
        [id, hashToken(`device-${id}`), code, testCase.status, new Date(Date.now() + (testCase.expired ? -60_000 : 60_000))],
      );

      expect(await markDenied(code)).toBe(testCase.accepted);
      const { rows } = await pool.query("SELECT status FROM cli_device_codes WHERE id = $1", [id]);
      expect(rows[0]?.status).toBe(testCase.finalStatus);
    }
  });

  it("approves only a still-pending and unexpired code", async () => {
    const cases = [
      { status: "pending", expired: false, accepted: true, finalStatus: "approved" },
      { status: "denied", expired: false, accepted: false, finalStatus: "denied" },
      { status: "consumed", expired: false, accepted: false, finalStatus: "consumed" },
      { status: "approved", expired: false, accepted: false, finalStatus: "approved" },
      { status: "pending", expired: true, accepted: false, finalStatus: "pending" },
    ] as const;

    for (const testCase of cases) {
      const id = crypto.randomUUID();
      const code = `code-${id}`;
      deviceIds.push(id);
      await pool.query(
        "INSERT INTO cli_device_codes (id, device_code_hash, user_code, status, expires_at) VALUES ($1, $2, $3, $4, $5)",
        [id, hashToken(`device-${id}`), code, testCase.status, new Date(Date.now() + (testCase.expired ? -60_000 : 60_000))],
      );

      expect(await markApproved(code, userId)).toBe(testCase.accepted);
      const { rows } = await pool.query("SELECT status, approved_user_id FROM cli_device_codes WHERE id = $1", [id]);
      expect(rows[0]?.status).toBe(testCase.finalStatus);
      expect(rows[0]?.approved_user_id).toBe(testCase.accepted ? userId : null);
    }
  });
});
