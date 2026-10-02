import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { Pool } from "pg";
import { NextRequest } from "next/server";
import { getPool } from "@/db/client";
import { openReadModelDatabase } from "../helpers/read-model-db";

// biome-ignore lint/complexity/useLiteralKeys: env access
const RUN_DB = process.env["DATABASE_URL"] != null;

/**
 * Database sessions, which local development never reaches: the dev sign-in
 * bypass forces the cookie strategy. Seed a session row and the session reads
 * back; delete the row and it does not.
 */
describe.skipIf(!RUN_DB)("browser sessions are revocable by deleting the row", () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  let GET: (req: NextRequest) => Promise<Response>;

  const ENV = {
  AUTH_SECRET: "test-auth-secret-at-least-32-bytes-long",
  AUTH_URL: "http://localhost:3000",
  AUTH_TRUST_HOST: "true",
  OIDC_ISSUER_URL: "https://auth.example.com/",
  OIDC_CLIENT_ID: "test-client",
  OIDC_CLIENT_SECRET: "test-secret",
};
const ENV_KEYS = Object.keys(ENV);

const TOKEN = "test-session-token-477";
  const USER = { id: "u-477", email: "revocable@example.com", name: "Revocable" };

  // next-auth reads `req.nextUrl` first, so the handler needs a NextRequest.
  const sessionRequest = (token?: string) =>
    new NextRequest("http://localhost:3000/api/auth/session", {
      headers: token ? { cookie: `authjs.session-token=${token}` } : {},
    });

  beforeAll(async () => {
    // Auth.js is configured at module load, so the env must be set before the
    // import below. NODE_ENV is "test", so the dev bypass is off and
    // sessionStrategy() resolves to "database".
    Object.assign(process.env, ENV);

    database = openReadModelDatabase();
    pool = await database.pool;
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
    await pool.query(
      'CREATE TABLE IF NOT EXISTS "user" (id text primary key, name text, email text, "emailVerified" timestamptz, image text)',
    );
    await pool.query(
      'CREATE TABLE IF NOT EXISTS "session" ("sessionToken" text primary key, "userId" text not null references "user"(id) on delete cascade, expires timestamptz not null)',
    );

    ({ GET } = await import("@/app/api/auth/[...nextauth]/route"));
  });

  // Scoped DELETEs, never TRUNCATE: six tables carry an FK to "user", including
  // scans.uploaded_by_user_id, so `TRUNCATE "user" CASCADE` would empty scans
  // and their read models regardless of onDelete. This suite removes only the
  // rows it created.
  beforeEach(async () => {
    await pool.query('DELETE FROM "session" WHERE "userId" = $1', [USER.id]);
    await pool.query(
      'INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [USER.id, USER.name, USER.email],
    );
    await pool.query(
      'INSERT INTO "session" ("sessionToken", "userId", expires) VALUES ($1, $2, now() + interval \'12 hours\')',
      [TOKEN, USER.id],
    );
  });

  afterAll(async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    await getPool().end();
    vi.unstubAllEnvs();
    await database.close();
  });

  it("reads the session back while the row exists", async () => {
    const body = await (await GET(sessionRequest(TOKEN))).json();
    expect(body?.user?.email).toBe(USER.email);
    expect(body?.user?.id).toBe(USER.id);
  });

  it("stops reading it back the moment the row is deleted", async () => {
    expect((await (await GET(sessionRequest(TOKEN))).json())?.user?.email).toBe(USER.email);

    await pool.query('DELETE FROM "session" WHERE "sessionToken" = $1', [TOKEN]);

    const after = await (await GET(sessionRequest(TOKEN))).json();
    expect(after?.user).toBeUndefined();
  });

  it("returns no session for a token that was never issued", async () => {
    const body = await (await GET(sessionRequest("not-a-real-token"))).json();
    expect(body?.user).toBeUndefined();
  });

  // The rows above are hand-written SQL. Sign-in writes sessions through the
  // adapter, which no test reaches without an IdP, so this calls the adapter
  // directly against the real schema.
  it("reads back a session the adapter itself created", async () => {
    const { DrizzleAdapter } = await import("@auth/drizzle-adapter");
    const { getDb, schema } = await import("@/db/client");
    const adapter = DrizzleAdapter(getDb(), {
      usersTable: schema.users,
      accountsTable: schema.accounts,
      sessionsTable: schema.sessions,
      verificationTokensTable: schema.verificationTokens,
    });
    await pool.query('DELETE FROM "session" WHERE "userId" = $1', [USER.id]);

    // biome-ignore lint/style/noNonNullAssertion: adapter always defines this
    await adapter.createSession!({
      sessionToken: "adapter-made-token",
      userId: USER.id,
      expires: new Date(Date.now() + 60 * 60 * 1000),
    });

    const body = await (await GET(sessionRequest("adapter-made-token"))).json();
    expect(body?.user?.id).toBe(USER.id);
  });

  it("returns no session when the row has expired", async () => {
    await pool.query('UPDATE "session" SET expires = now() - interval \'1 minute\'');
    const body = await (await GET(sessionRequest(TOKEN))).json();
    expect(body?.user).toBeUndefined();
  });
});
