import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { getPool } from "@/db/client";
import { insertPerson } from "../helpers/people";
import { openReadModelDatabase } from "../helpers/read-model-db";

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));
vi.mock("next-auth", () => ({
  default: vi.fn(() => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn(async () => session.current) })),
}));
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: vi.fn(() => ({})) }));
vi.mock("@/lib/auth-providers", () => ({
  buildProviders: vi.fn(() => []),
  isDevAuthEnabled: vi.fn(() => false),
}));

// biome-ignore lint/complexity/useLiteralKeys: env access
const RUN_DB = process.env["DATABASE_URL"] != null;

describe.skipIf(!RUN_DB)("OIDC sign-in while a browser session exists, against PostgreSQL", () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  let ana: string;

  const oidcSignIn = async (providerAccountId: string): Promise<boolean | string> => {
    const { default: NextAuth } = await import("next-auth");
    const options = vi.mocked(NextAuth).mock.calls[0]?.[0];
    if (!options || typeof options === "function") throw new Error("Auth.js was not configured");
    const callback = options.callbacks?.signIn;
    if (!callback) throw new Error("OIDC sign-in callback was not configured");
    return callback({
      user: { id: providerAccountId, email: "bo@example.com" },
      account: { provider: "oidc", providerAccountId, type: "oidc", access_token: "idp-token" },
      profile: { sub: providerAccountId, email: "bo@example.com", email_verified: true },
    } as Parameters<typeof callback>[0]);
  };

  beforeAll(async () => {
    database = openReadModelDatabase();
    pool = await database.pool;
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
    await import("@/auth");
  });

  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
    vi.stubEnv("OIDC_ALLOWED_DOMAINS", undefined);
    ana = await insertPerson(pool, { email: "ana@example.com", role: "editor" });
    await pool.query(
      `INSERT INTO "account" ("userId", type, provider, "providerAccountId") VALUES ($1, 'oidc', 'oidc', 'ana-subject')`,
      [ana],
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    session.current = null;
    await pool.query('DELETE FROM "user"');
  });

  afterAll(async () => {
    await getPool().end();
    vi.unstubAllEnvs();
    await database.close();
  });

  it("refuses a provider account that isn't linked yet while someone is signed in", async () => {
    session.current = { user: { id: ana } };
    await expect(oidcSignIn("bo-subject")).resolves.toBe(false);
  });

  it("lets the signed-in person sign in again with the account already linked to them", async () => {
    session.current = { user: { id: ana } };
    await expect(oidcSignIn("ana-subject")).resolves.toBe(true);
  });

  it("lets a provider account that isn't linked yet sign in when nobody is signed in", async () => {
    await expect(oidcSignIn("bo-subject")).resolves.toBe(true);
  });
});
