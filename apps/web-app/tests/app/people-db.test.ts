import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { changeRole, removeFromPeople } from "@/app/settings/people-actions";
import { getPool } from "@/db/client";
import type { Role } from "@/lib/access";
import { consumeApprovedDeviceCode } from "@/lib/cli-session-store";
import { hashToken } from "@/lib/cli-session-tokens";
import { identify } from "@/lib/identity";
import { listPeople, listRoleChanges, recordSignIn } from "@/lib/people";
import { insertPerson } from "../helpers/people";
import { openReadModelDatabase } from "../helpers/read-model-db";

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => session.current) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// biome-ignore lint/complexity/useLiteralKeys: env access
const RUN_DB = process.env["DATABASE_URL"] != null;

const ADMIN_REFUSAL = { ok: false, error: "Only Admins can change roles." };
const CHANGED_SINCE_LOADED = { ok: false, error: "This person's role has changed since the page loaded. Reload to see it." };

describe.skipIf(!RUN_DB)("People actions against PostgreSQL", () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  let admin: string;

  const signInAs = (userId: string) => {
    session.current = { user: { id: userId } };
  };
  const stored = async (id: string) =>
    (await pool.query(`SELECT role, admin_group FROM "user" WHERE id = $1`, [id])).rows[0];
  const history = async () =>
    (await pool.query("SELECT actor_email, subject_email, from_role, to_role FROM role_changes")).rows;
  const addBrowserSession = (userId: string) =>
    pool.query(
      `INSERT INTO "session" ("sessionToken", "userId", expires) VALUES ($1, $2, now() + interval '12 hours')`,
      [crypto.randomUUID(), userId],
    );
  const addApprovedDeviceCode = async (userId: string): Promise<string> => {
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO cli_device_codes (id, device_code_hash, user_code, status, approved_user_id, expires_at) VALUES ($1, $2, $3, 'approved', $4, now() + interval '10 minutes')",
      [id, hashToken(`device-${id}`), `code-${id}`, userId],
    );
    return id;
  };
  const signIns = async (userId: string) =>
    (await pool.query(
      `SELECT (SELECT count(*) FROM "session" WHERE "userId" = $1)::int AS browser,
              (SELECT count(*) FROM cli_sessions WHERE user_id = $1)::int AS cli,
              (SELECT count(*) FROM cli_device_codes WHERE approved_user_id = $1)::int AS device_codes`,
      [userId],
    )).rows[0];

  beforeAll(async () => {
    database = openReadModelDatabase();
    pool = await database.pool;
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
  });

  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
    vi.stubEnv("SCOUTUI_ADMINS", undefined);
    vi.stubEnv("SCOUTUI_ADMIN_GROUP", undefined);
    admin = await insertPerson(pool, { email: "ana@example.com", role: "admin" });
    signInAs(admin);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    session.current = null;
    await pool.query("DELETE FROM role_changes");
    await pool.query("DELETE FROM cli_device_codes");
    await pool.query('DELETE FROM "user"');
  });

  afterAll(async () => {
    await getPool().end();
    vi.unstubAllEnvs();
    await database.close();
  });

  it("refuses a role change from someone signed out or an Editor and keeps the role, and an Admin's change records one history entry", async () => {
    const editor = await insertPerson(pool, { email: "bo@example.com", role: "editor" });
    const sam = await insertPerson(pool, { email: "sam@example.com" });

    session.current = null;
    expect(await changeRole(sam, "editor")).toEqual({ ok: false, error: "not_authenticated" });
    signInAs(editor);
    expect(await changeRole(sam, "editor")).toEqual(ADMIN_REFUSAL);
    expect(await stored(sam)).toMatchObject({ role: "viewer" });
    expect(await history()).toEqual([]);

    signInAs(admin);
    expect(await changeRole(sam, "editor")).toEqual({ ok: true });
    expect(await stored(sam)).toMatchObject({ role: "editor" });
    expect(await history()).toEqual([
      { actor_email: "ana@example.com", subject_email: "sam@example.com", from_role: "viewer", to_role: "editor" },
    ]);
  });

  const targets = {
    themself: async () => admin,
    "an Admin named in SCOUTUI_ADMINS": async () => {
      vi.stubEnv("SCOUTUI_ADMINS", "lee@example.com");
      return insertPerson(pool, { email: "lee@example.com", role: "editor", verified: true });
    },
    "a member of SCOUTUI_ADMIN_GROUP": async () => {
      vi.stubEnv("SCOUTUI_ADMIN_GROUP", "scout-admins");
      return insertPerson(pool, { email: "lee@example.com", role: "editor", adminGroup: "scout-admins" });
    },
    "a removed person": async () => insertPerson(pool, { email: "lee@example.com", role: null }),
  };
  const actions = {
    demote: (userId: string) => changeRole(userId, "viewer"),
    remove: (userId: string) => removeFromPeople(userId),
  };

  const cases = Object.keys(actions)
    .flatMap(action => Object.keys(targets).map(target => [action, target]))
    .filter(([action, target]) => !(action === "remove" && target === "a member of SCOUTUI_ADMIN_GROUP"));

  it.each(cases)(
    "won't let an Admin %s %s, but will for an ordinary person",
    async (action, target) => {
      const run = actions[action as keyof typeof actions];
      const fixed = await targets[target as keyof typeof targets]();
      await addBrowserSession(fixed);
      const before = await stored(fixed);

      expect(await run(fixed)).toEqual(CHANGED_SINCE_LOADED);
      expect(await stored(fixed)).toEqual(before);
      expect(await signIns(fixed)).toMatchObject({ browser: 1 });
      expect(await history()).toEqual([]);

      const sam = await insertPerson(pool, { email: "sam@example.com", role: "editor" });
      expect(await run(sam)).toEqual({ ok: true });
      expect(await history()).toHaveLength(1);
    },
  );

  it("refuses a role that isn't Viewer, Editor or Admin, and sets one that is", async () => {
    const sam = await insertPerson(pool, { email: "sam@example.com" });
    expect(await changeRole(sam, "owner" as Role)).toEqual(CHANGED_SINCE_LOADED);
    expect(await stored(sam)).toMatchObject({ role: "viewer" });
    expect(await changeRole(sam, "admin")).toEqual({ ok: true });
    expect(await stored(sam)).toMatchObject({ role: "admin" });
  });

  it("refuses an Editor's removal, and an Admin's removal ends every browser and CLI sign-in, clears the role and records it", async () => {
    const editor = await insertPerson(pool, { email: "bo@example.com", role: "editor" });
    const sam = await insertPerson(pool, { email: "sam@example.com", role: "editor", adminGroup: "old-admins" });
    await pool.query(
      `INSERT INTO "account" ("userId", type, provider, "providerAccountId") VALUES ($1, 'oidc', 'oidc', 'sam-subject')`,
      [sam],
    );
    await addBrowserSession(sam);
    const usedCode = await addApprovedDeviceCode(sam);
    expect(await consumeApprovedDeviceCode(usedCode, sam)).not.toBeNull();
    await addApprovedDeviceCode(sam);
    expect(await signIns(sam)).toEqual({ browser: 1, cli: 1, device_codes: 2 });

    signInAs(editor);
    expect(await removeFromPeople(sam)).toEqual(ADMIN_REFUSAL);
    expect(await signIns(sam)).toEqual({ browser: 1, cli: 1, device_codes: 2 });
    expect(await stored(sam)).toEqual({ role: "editor", admin_group: "old-admins" });

    signInAs(admin);
    expect(await removeFromPeople(sam)).toEqual({ ok: true });
    expect(await signIns(sam)).toEqual({ browser: 0, cli: 0, device_codes: 0 });
    expect(await stored(sam)).toEqual({ role: null, admin_group: null });
    expect((await pool.query(`SELECT count(*)::int AS n FROM "account" WHERE "userId" = $1`, [sam])).rows[0].n).toBe(1);
    expect(await history()).toEqual([
      { actor_email: "ana@example.com", subject_email: "sam@example.com", from_role: "editor", to_role: null },
    ]);
  });

  it("removes a member of SCOUTUI_ADMIN_GROUP, ending every browser and CLI sign-in and clearing their role and group", async () => {
    vi.stubEnv("SCOUTUI_ADMIN_GROUP", "scout-admins");
    const mo = await insertPerson(pool, { email: "mo@example.com", adminGroup: "scout-admins" });
    await addBrowserSession(mo);
    expect(await consumeApprovedDeviceCode(await addApprovedDeviceCode(mo), mo)).not.toBeNull();
    await addApprovedDeviceCode(mo);
    expect(await signIns(mo)).toEqual({ browser: 1, cli: 1, device_codes: 2 });

    expect(await removeFromPeople(mo)).toEqual({ ok: true });
    expect(await signIns(mo)).toEqual({ browser: 0, cli: 0, device_codes: 0 });
    expect(await stored(mo)).toEqual({ role: null, admin_group: null });
    expect(await history()).toEqual([
      { actor_email: "ana@example.com", subject_email: "mo@example.com", from_role: "admin", to_role: null },
    ]);
  });

  it.each([
    ["still in the group", "an Admin", ["scout-users", "scout-admins"], { role: "admin", roleSource: "group" }],
    ["no longer in the group", "a Viewer", ["scout-users"], { role: "viewer", roleSource: "people" }],
  ] as const)("brings a removed SCOUTUI_ADMIN_GROUP member who is %s back as %s when they sign in again", async (_still, _as, groups, comesBackAs) => {
    vi.stubEnv("SCOUTUI_ADMIN_GROUP", "scout-admins");
    const mo = await insertPerson(pool, { email: "mo@example.com", adminGroup: "scout-admins" });
    expect(await removeFromPeople(mo)).toEqual({ ok: true });

    signInAs(mo);
    expect(await identify({ browser: true })).toBeNull();
    await recordSignIn(
      { userId: mo, email: "mo@example.com", provider: "oidc", emailVerified: true, accessToken: "access-token" },
      async () => [...groups],
    );
    expect(await identify({ browser: true })).toMatchObject({ kind: "person", userId: mo, ...comesBackAs });
  });

  it("stops a removed person's approved CLI sign-in from giving a session, while a kept person's still does", async () => {
    const kept = await insertPerson(pool, { email: "bo@example.com", role: "editor" });
    const removed = await insertPerson(pool, { email: "sam@example.com", role: "editor" });
    const keptCode = await addApprovedDeviceCode(kept);
    const removedCode = await addApprovedDeviceCode(removed);

    expect(await removeFromPeople(removed)).toEqual({ ok: true });
    expect(await consumeApprovedDeviceCode(removedCode, removed)).toBeNull();
    expect(await consumeApprovedDeviceCode(keptCode, kept)).toMatchObject({ email: "bo@example.com" });
  });

  it("lets a removed person back in as a Viewer when they sign in again", async () => {
    const sam = await insertPerson(pool, { email: "sam@example.com", role: "editor" });
    expect(await removeFromPeople(sam)).toEqual({ ok: true });

    signInAs(sam);
    expect(await identify({ browser: true })).toBeNull();
    await recordSignIn({ userId: sam, email: "sam@example.com", provider: "oidc", emailVerified: true, accessToken: "access-token" });
    expect(await identify({ browser: true })).toMatchObject({ kind: "person", userId: sam, role: "viewer" });
  });

  it("lists everyone who wasn't removed by email, with an Admin named in SCOUTUI_ADMINS shown as set at install", async () => {
    vi.stubEnv("SCOUTUI_ADMINS", "lee@example.com");
    const lee = await insertPerson(pool, { email: "lee@example.com", name: "Lee", verified: true });
    const bo = await insertPerson(pool, { email: "bo@example.com", role: "editor" });
    await insertPerson(pool, { email: "abe@example.com", role: null });
    await pool.query(`UPDATE "user" SET last_signed_in_at = '2026-10-01T09:30:00Z' WHERE id = $1`, [lee]);

    expect(await listPeople()).toEqual([
      { userId: admin, name: null, email: "ana@example.com", lastSignedInAt: null, role: "admin", roleSource: "people" },
      { userId: bo, name: null, email: "bo@example.com", lastSignedInAt: null, role: "editor", roleSource: "people" },
      { userId: lee, name: "Lee", email: "lee@example.com", lastSignedInAt: "2026-10-01T09:30:00.000Z", role: "admin", roleSource: "install" },
    ]);
  });

  it("lists the latest role changes, newest first", async () => {
    await pool.query(
      `INSERT INTO role_changes (id, changed_at, actor_email, subject_email, from_role, to_role) VALUES
         ('change-1', '2026-10-01T00:00:00Z', 'ana@example.com', 'bo@example.com', 'viewer', 'editor'),
         ('change-2', '2026-10-03T00:00:00Z', 'ana@example.com', 'sam@example.com', 'editor', NULL),
         ('change-3', '2026-10-02T00:00:00Z', 'ana@example.com', 'bo@example.com', 'editor', 'admin')`,
    );
    expect(await listRoleChanges(2)).toEqual([
      { id: "change-2", changedAt: "2026-10-03T00:00:00.000Z", actorEmail: "ana@example.com", subjectEmail: "sam@example.com", fromRole: "editor", toRole: null },
      { id: "change-3", changedAt: "2026-10-02T00:00:00.000Z", actorEmail: "ana@example.com", subjectEmail: "bo@example.com", fromRole: "editor", toRole: "admin" },
    ]);
  });
});
