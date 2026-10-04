import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { getPool } from "@/db/client";
import { type Action, can, type Identity, type Role } from "@/lib/access";
import { consumeApprovedDeviceCode } from "@/lib/cli-session-store";
import { hashToken } from "@/lib/cli-session-tokens";
import { identify } from "@/lib/identity";
import { recordSignIn } from "@/lib/people";
import { insertPerson } from "../helpers/people";
import { openReadModelDatabase } from "../helpers/read-model-db";

const session = vi.hoisted(() => ({ current: null as { user: { id: string; role?: string } } | null }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => session.current) }));

// biome-ignore lint/complexity/useLiteralKeys: env access
const RUN_DB = process.env["DATABASE_URL"] != null;

describe.skipIf(!RUN_DB)("identify and recordSignIn against PostgreSQL", () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  let warn: ReturnType<typeof vi.spyOn>;

  const browser = () => identify({ browser: true });
  const signInAs = (userId: string) => {
    session.current = { user: { id: userId } };
  };

  beforeAll(async () => {
    database = openReadModelDatabase();
    pool = await database.pool;
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
  });

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
    vi.stubEnv("SCOUTUI_ADMINS", undefined);
    vi.stubEnv("SCOUTUI_ADMIN_GROUP", undefined);
    session.current = null;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    vi.unstubAllEnvs();
    await pool.query("DELETE FROM cli_device_codes");
    await pool.query('DELETE FROM "user"');
  });

  afterAll(async () => {
    await getPool().end();
    vi.unstubAllEnvs();
    await database.close();
  });

  it("gives a stored Editor's browser session the Editor role, and nobody without a session", async () => {
    const id = await insertPerson(pool, { email: "ana@example.com", name: "Ana", role: "editor" });
    expect(await browser()).toBeNull();
    signInAs(id);
    expect(await browser()).toEqual({
      kind: "person", userId: id, email: "ana@example.com", name: "Ana", role: "editor", roleSource: "people",
    });
  });

  it("makes a verified email in SCOUTUI_ADMINS an Admin in any letter case, and leaves it its stored role unverified", async () => {
    vi.stubEnv("SCOUTUI_ADMINS", "Ana@Example.com");
    const id = await insertPerson(pool, { email: "ana@example.com", verified: true });
    signInAs(id);
    expect(await browser()).toMatchObject({ role: "admin", roleSource: "install" });
    await pool.query('UPDATE "user" SET "emailVerified" = NULL WHERE id = $1', [id]);
    expect(await browser()).toMatchObject({ role: "viewer", roleSource: "people" });
  });

  it("makes a member of SCOUTUI_ADMIN_GROUP an Admin, and leaves them their stored role when it's unset or names another group", async () => {
    const id = await insertPerson(pool, { email: "ana@example.com", adminGroup: "scout-admins" });
    signInAs(id);
    vi.stubEnv("SCOUTUI_ADMIN_GROUP", "scout-admins");
    expect(await browser()).toMatchObject({ role: "admin", roleSource: "group" });
    vi.stubEnv("SCOUTUI_ADMIN_GROUP", undefined);
    expect(await browser()).toMatchObject({ role: "viewer", roleSource: "people" });
    vi.stubEnv("SCOUTUI_ADMIN_GROUP", "other");
    expect(await browser()).toMatchObject({ role: "viewer", roleSource: "people" });
  });

  it("returns nobody for a removed person, and the person for one who wasn't removed", async () => {
    const removed = await insertPerson(pool, { email: "ana@example.com", role: null });
    const kept = await insertPerson(pool, { email: "bo@example.com" });
    signInAs(removed);
    expect(await browser()).toBeNull();
    signInAs(kept);
    expect(await browser()).toMatchObject({ kind: "person", userId: kept, role: "viewer" });
  });

  it("reads the role from the database on every request", async () => {
    const id = await insertPerson(pool, { email: "ana@example.com" });
    signInAs(id);
    expect(await browser()).toMatchObject({ role: "viewer" });
    await pool.query(`UPDATE "user" SET role = 'editor' WHERE id = $1`, [id]);
    expect(await browser()).toMatchObject({ role: "editor" });
  });

  it("ignores a role carried on the session", async () => {
    const id = await insertPerson(pool, { email: "ana@example.com" });
    session.current = { user: { id, role: "admin" } };
    expect(await browser()).toMatchObject({ role: "viewer", roleSource: "people" });
  });

  it("recognises the CI upload secret, and nobody for a wrong, longer or unprefixed secret, or once the secret is unset", async () => {
    vi.stubEnv("SCOUTUI_CI_UPLOAD_TOKEN", "ci-secret-1234");
    expect(await identify({ bearer: "Bearer ci-secret-1234" })).toEqual({ kind: "ci" });
    expect(await identify({ bearer: "Bearer ci-secret-9999" })).toBeNull();
    expect(await identify({ bearer: "Bearer ci-secret-12345" })).toBeNull();
    expect(await identify({ bearer: "ci-secret-1234" })).toBeNull();
    expect(await identify({ bearer: null })).toBeNull();
    vi.stubEnv("SCOUTUI_CI_UPLOAD_TOKEN", undefined);
    expect(await identify({ bearer: "Bearer ci-secret-1234" })).toBeNull();
  });

  it("gives a CLI token its person with their stored role and records the sign-in, and nobody for an unknown token", async () => {
    const id = await insertPerson(pool, { email: "ana@example.com", role: "editor" });
    const deviceId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO cli_device_codes (id, device_code_hash, user_code, status, approved_user_id, expires_at) VALUES ($1, $2, $3, 'approved', $4, now() + interval '10 minutes')",
      [deviceId, hashToken(`device-${deviceId}`), `code-${deviceId}`, id],
    );
    const issued = await consumeApprovedDeviceCode(deviceId, id);
    expect(await identify({ bearer: `Bearer ${issued?.token}` })).toEqual({
      kind: "person", userId: id, email: "ana@example.com", name: null, role: "editor", roleSource: "people",
    });
    const { rows } = await pool.query(
      `SELECT last_signed_in_at > now() - interval '1 minute' AS signed_in_now FROM "user" WHERE id = $1`,
      [id],
    );
    expect(rows).toEqual([{ signed_in_now: true }]);
    expect(await identify({ bearer: `Bearer scout_u_${"a".repeat(43)}` })).toBeNull();
  });

  it.each([
    { email: "ANA@Example.com", admin: true },
    { email: "a.na+x@example.com", admin: false },
    { email: "ana@example.com.evil.test", admin: false },
  ])("with SCOUTUI_ADMINS set to ana@example.com, a verified $email is an Admin: $admin", async ({ email, admin }) => {
    vi.stubEnv("SCOUTUI_ADMINS", " ana@example.com ");
    signInAs(await insertPerson(pool, { email, verified: true }));
    expect(await browser()).toMatchObject({ role: admin ? "admin" : "viewer" });
  });

  describe("recordSignIn", () => {
    const signIn = (userId: string, emailVerified: boolean) =>
      recordSignIn({ userId, email: "ana@example.com", provider: "oidc", emailVerified, accessToken: "access-token" });
    const stored = async (id: string) => {
      const { rows } = await pool.query(
        `SELECT "emailVerified" IS NOT NULL AS verified, last_signed_in_at > now() - interval '1 minute' AS signed_in_now, role, admin_group FROM "user" WHERE id = $1`,
        [id],
      );
      return rows[0];
    };

    it("stores a verified email and the sign-in time, and clears the verification when the provider didn't verify the email", async () => {
      vi.stubEnv("SCOUTUI_ADMINS", "ana@example.com");
      const id = await insertPerson(pool, { email: "ana@example.com" });
      await signIn(id, true);
      expect(await stored(id)).toMatchObject({ verified: true, signed_in_now: true });
      expect(warn).not.toHaveBeenCalled();
      await signIn(id, false);
      expect(await stored(id)).toMatchObject({ verified: false });
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        "[auth] ana@example.com is in SCOUTUI_ADMINS, but the sign-in provider didn't mark the email verified, so they aren't an Admin.",
      );
    });

    it("brings a removed person back as a Viewer, and keeps anyone else's role", async () => {
      const removed = await insertPerson(pool, { email: "ana@example.com", role: null });
      const editor = await insertPerson(pool, { email: "bo@example.com", role: "editor" });
      await signIn(removed, true);
      await signIn(editor, true);
      expect(await stored(removed)).toMatchObject({ role: "viewer" });
      expect(await stored(editor)).toMatchObject({ role: "editor" });
    });

    it("stores the admin group when the provider lists it, and clears it without failing the sign-in when the lookup fails", async () => {
      vi.stubEnv("SCOUTUI_ADMIN_GROUP", "scout-admins");
      const id = await insertPerson(pool, { email: "ana@example.com" });
      const input = { userId: id, email: "ana@example.com", provider: "oidc", emailVerified: true, accessToken: "access-token" };
      await recordSignIn(input, async () => ["scout-users", "scout-admins"]);
      expect(await stored(id)).toMatchObject({ admin_group: "scout-admins" });
      await expect(recordSignIn(input, async () => {
        throw new Error("userinfo 503");
      })).resolves.toBeUndefined();
      expect(await stored(id)).toMatchObject({ admin_group: null, signed_in_now: true });
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        "[auth] Couldn't check whether ana@example.com is in SCOUTUI_ADMIN_GROUP, so they aren't an Admin until they sign in again: userinfo 503",
      );
    });
  });
});

describe("can", () => {
  const person = (role: Role): Identity => ({
    kind: "person", userId: "u1", email: "ana@example.com", name: null, role, roleSource: "people",
  });
  const rows: { who: string; identity: Identity | null; action: Action; allowed: boolean }[] = [
    { who: "nobody", identity: null, action: "view", allowed: false },
    { who: "a Viewer", identity: person("viewer"), action: "view", allowed: true },
    { who: "a Viewer", identity: person("viewer"), action: "edit", allowed: false },
    { who: "a Viewer", identity: person("viewer"), action: "upload", allowed: false },
    { who: "a Viewer", identity: person("viewer"), action: "manage-people", allowed: false },
    { who: "an Editor", identity: person("editor"), action: "edit", allowed: true },
    { who: "an Editor", identity: person("editor"), action: "upload", allowed: true },
    { who: "an Editor", identity: person("editor"), action: "manage-people", allowed: false },
    { who: "an Admin", identity: person("admin"), action: "manage-people", allowed: true },
    { who: "the CI secret", identity: { kind: "ci" }, action: "upload", allowed: true },
    { who: "the CI secret", identity: { kind: "ci" }, action: "view", allowed: false },
    { who: "the CI secret", identity: { kind: "ci" }, action: "edit", allowed: false },
    { who: "the CI secret", identity: { kind: "ci" }, action: "manage-people", allowed: false },
  ];

  it.each(rows)("$who may $action: $allowed", ({ identity, action, allowed }) => {
    expect(can(identity, action)).toBe(allowed);
  });
});
