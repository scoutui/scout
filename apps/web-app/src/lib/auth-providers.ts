import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

function requiredEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) {
    // `next build` constructs providers while collecting page data, before the
    // runtime env exists, so return a placeholder there. Auth.js throws on the
    // first OIDC request if the variable is really missing.
    // biome-ignore lint/complexity/useLiteralKeys: env access
    if (env["NEXT_PHASE"] === "phase-production-build") return "";
    throw new Error(`${name} is required`);
  }
  return value;
}

/**
 * Whether the local dev sign-in bypass is active: an email and password form
 * that skips OIDC. Needs both `NODE_ENV=development` and a non-empty
 * `DEV_AUTH_PASSWORD`, so it can't activate in a production build.
 */
export function isDevAuthEnabled(env: Record<string, string | undefined> = process.env): boolean {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  return env["NODE_ENV"] === "development" && Boolean(env["DEV_AUTH_PASSWORD"]);
}

/** Whether OIDC single sign-on is wired up (its issuer is configured). */
export function isOidcConfigured(env: Record<string, string | undefined> = process.env): boolean {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  return Boolean(env["OIDC_ISSUER_URL"]);
}

/**
 * Build the Auth.js provider list from the environment.
 *
 * OIDC is required everywhere except local dev with the sign-in bypass active,
 * where a contributor can run the app without an IdP. A configured OIDC provider
 * is always wired up, so a partial dev setup is still validated, and the dev
 * provider is added alongside it whenever the bypass is active.
 */
export function buildProviders(env: Record<string, string | undefined> = process.env): Provider[] {
  const providers: Provider[] = [];
  const devAuthEnabled = isDevAuthEnabled(env);

  if (isOidcConfigured(env) || !devAuthEnabled) {
    providers.push({
      id: "oidc",
      name: "SSO",
      type: "oidc",
      issuer: requiredEnv(env, "OIDC_ISSUER_URL"),
      clientId: requiredEnv(env, "OIDC_CLIENT_ID"),
      clientSecret: requiredEnv(env, "OIDC_CLIENT_SECRET"),
      authorization: { params: { scope: "openid profile email" } },
      // Auth.js v5 handles OIDC discovery, PKCE, and token exchange automatically
      // when type: "oidc" + issuer is set.
    });
  }

  if (devAuthEnabled) {
    // biome-ignore lint/complexity/useLiteralKeys: env access
    const devPassword = env["DEV_AUTH_PASSWORD"];
    providers.push(
      Credentials({
        id: "dev",
        name: "Dev",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        authorize: async (creds) => {
          if (creds?.password !== devPassword) return null;
          if (typeof creds?.email !== "string" || !creds.email.includes("@")) return null;
          // split("@")[0] is `string | undefined` under noUncheckedIndexedAccess.
          const name = creds.email.split("@")[0] ?? creds.email;
          // Credentials sign-ins never reach the adapter, so nothing else stores
          // this user, but device approval, CLI sessions and scan rows all have a
          // foreign key to `user`. Reuse the row for this email or insert one.
          const db = getDb();
          const existing = await db.query.users.findFirst({
            where: eq(schema.users.email, creds.email),
            columns: { id: true, name: true },
          });
          if (existing) {
            return { id: existing.id, email: creds.email, name: existing.name ?? name };
          }
          const [created] = await db
            .insert(schema.users)
            .values({ id: `dev-${creds.email}`, email: creds.email, name })
            .returning({ id: schema.users.id });
          if (!created) return null;
          return { id: created.id, email: creds.email, name };
        },
      }),
    );
  }

  return providers;
}
