import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import type { Pool } from "pg";
import { NextRequest } from "next/server";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { getPool } from "@/db/client";
import { openReadModelDatabase } from "../helpers/read-model-db";

// biome-ignore lint/complexity/useLiteralKeys: env access
const RUN_DB = process.env["DATABASE_URL"] != null;

/**
 * A provider POSTs a logout token, and the person it names stops being signed
 * in. Signature verification, the delete against the real schema and the
 * session route are all real; only the identity provider's two HTTP endpoints
 * are stubbed.
 */
describe.skipIf(!RUN_DB)("back-channel logout ends a signed-in person's browser session", () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  let POST: (req: Request) => Promise<Response>;
  let GET: (req: NextRequest) => Promise<Response>;
  let privateKey: CryptoKey;
  let publicJwk: Record<string, unknown>;

  // Trailing slash, with OIDC_ISSUER_URL configured without one: the asymmetry
  // a real Authentik presents.
  const ISSUER = "https://idp.test/issuer/";
  const CLIENT_ID = "scout-474";
  const JWKS_URI = "https://idp.test/jwks";
  const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

  const ENV = {
    AUTH_SECRET: "test-auth-secret-at-least-32-bytes-long",
    AUTH_URL: "http://localhost:3000",
    AUTH_TRUST_HOST: "true",
    OIDC_ISSUER_URL: ISSUER.replace(/\/$/, ""),
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_CLIENT_SECRET: "test-secret",
  };
  const ENV_KEYS = Object.keys(ENV);

  const SUB = "idp-subject-474";
  const USER = { id: "u-474", email: "backchannel@example.com", name: "Backchannel" };
  const TOKEN = "test-session-token-474";
  const OTHER = { id: "u-474-other", email: "bystander@example.com", name: "Bystander" };
  const OTHER_TOKEN = "test-session-token-474-other";

  const logoutRequest = (logoutToken: string) =>
    new Request("http://localhost:3000/api/auth/backchannel-logout", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ logout_token: logoutToken }),
    });

  const sessionRequest = (token: string) =>
    new NextRequest("http://localhost:3000/api/auth/session", {
      headers: { cookie: `authjs.session-token=${token}` },
    });

  async function logoutToken(sub: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: ISSUER,
      aud: CLIENT_ID,
      iat: now,
      exp: now + 300,
      jti: crypto.randomUUID(),
      sub,
      events: { [BACKCHANNEL_EVENT]: {} },
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "logout+jwt" })
      .sign(privateKey);
  }

  beforeAll(async () => {
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
    await pool.query(
      'CREATE TABLE IF NOT EXISTS "account" ("userId" text not null references "user"(id) on delete cascade, type text not null, provider text not null, "providerAccountId" text not null, refresh_token text, access_token text, expires_at integer, token_type text, scope text, id_token text, session_state text, primary key (provider, "providerAccountId"))',
    );

    ({ POST } = await import("@/app/api/auth/backchannel-logout/route"));
    ({ GET } = await import("@/app/api/auth/[...nextauth]/route"));
  });

  beforeEach(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    privateKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), alg: "RS256", use: "sig", kid: "test-key" };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes(".well-known")) {
        return new Response(JSON.stringify({ issuer: ISSUER, jwks_uri: JWKS_URI }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u === JWKS_URI) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { "content-type": "application/jwk-set+json" },
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });

    const { resetRateLimitState } = await import("@/lib/rate-limit");
    resetRateLimitState();

    // Scoped DELETEs, never TRUNCATE: six tables carry an FK to "user", so
    // `TRUNCATE "user" CASCADE` would follow every one of them regardless of
    // onDelete and empty a database this suite was only meant to read.
    await cleanup();
    for (const u of [USER, OTHER]) {
      await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [
        u.id,
        u.name,
        u.email,
      ]);
    }
    await pool.query(
      'INSERT INTO "account" ("userId", type, provider, "providerAccountId") VALUES ($1, $2, $3, $4)',
      [USER.id, "oidc", "oidc", SUB],
    );
    for (const [id, token] of [
      [USER.id, TOKEN],
      [OTHER.id, OTHER_TOKEN],
    ]) {
      await pool.query(
        'INSERT INTO "session" ("sessionToken", "userId", expires) VALUES ($1, $2, now() + interval \'12 hours\')',
        [token, id],
      );
    }
  });

  afterEach(() => vi.restoreAllMocks());

  async function cleanup() {
    const ids = [USER.id, OTHER.id];
    await pool.query('DELETE FROM "session" WHERE "userId" = ANY($1)', [ids]);
    await pool.query('DELETE FROM "account" WHERE "userId" = ANY($1)', [ids]);
  }

  afterAll(async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    await getPool().end();
    vi.unstubAllEnvs();
    await database.close();
  });

  it("signs the subject out: the session reads back before, and not after", async () => {
    expect((await (await GET(sessionRequest(TOKEN))).json())?.user?.email).toBe(USER.email);

    const res = await POST(logoutRequest(await logoutToken(SUB)));
    expect(res.status).toBe(200);

    expect((await (await GET(sessionRequest(TOKEN))).json())?.user).toBeUndefined();
  });

  it("leaves everyone else signed in", async () => {
    await POST(logoutRequest(await logoutToken(SUB)));
    expect((await (await GET(sessionRequest(OTHER_TOKEN))).json())?.user?.email).toBe(OTHER.email);
  });

  it("ends every browser session that subject holds, not just one", async () => {
    await pool.query(
      'INSERT INTO "session" ("sessionToken", "userId", expires) VALUES ($1, $2, now() + interval \'12 hours\')',
      ["test-session-token-474-second", USER.id],
    );
    await POST(logoutRequest(await logoutToken(SUB)));
    const { rowCount } = await pool.query('SELECT 1 FROM "session" WHERE "userId" = $1', [USER.id]);
    expect(rowCount).toBe(0);
  });

  it("returns 200 and deletes nothing for a subject nobody has signed in as", async () => {
    const res = await POST(logoutRequest(await logoutToken("idp-subject-never-seen")));
    expect(res.status).toBe(200);
    expect((await (await GET(sessionRequest(TOKEN))).json())?.user?.email).toBe(USER.email);
  });

  it("leaves the subject signed in when the token does not verify", async () => {
    const impostor = await generateKeyPair("RS256", { extractable: true });
    const forged = await new SignJWT({
      iss: ISSUER,
      aud: CLIENT_ID,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: crypto.randomUUID(),
      sub: SUB,
      events: { [BACKCHANNEL_EVENT]: {} },
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "logout+jwt" })
      .sign(impostor.privateKey);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await POST(logoutRequest(forged))).status).toBe(400);
    expect((await (await GET(sessionRequest(TOKEN))).json())?.user?.email).toBe(USER.email);
  });

  it("ends the subject's CLI sessions too, and nobody else's", async () => {
    await pool.query(
      "INSERT INTO cli_sessions (id, user_id, token_hash) VALUES ($1, $2, $3), ($4, $5, $6) ON CONFLICT (id) DO NOTHING",
      ["cli-474", USER.id, "hash-474", "cli-474-other", OTHER.id, "hash-474-other"],
    );
    try {
      expect((await POST(logoutRequest(await logoutToken(SUB)))).status).toBe(200);
      const { rows } = await pool.query("SELECT id FROM cli_sessions WHERE id = ANY($1)", [["cli-474", "cli-474-other"]]);
      expect(rows).toEqual([{ id: "cli-474-other" }]);
    } finally {
      await pool.query("DELETE FROM cli_sessions WHERE id = ANY($1)", [["cli-474", "cli-474-other"]]);
    }
  });
});
