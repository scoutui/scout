import { NextResponse } from "next/server";
import { sessionStrategy } from "@/lib/auth-session";
import { deleteSessionsForOidcSubject } from "@/lib/browser-session-store";
import { LogoutTokenError, verifyLogoutToken } from "@/lib/logout-token";
import { clientKey, logRateLimitRejection, rateLimit } from "@/lib/rate-limit";

/**
 * OIDC Back-Channel Logout receiver: the identity provider POSTs a signed
 * logout token here when a person's IdP session ends, and their browser
 * sessions go with it. No browser is involved.
 *
 * The middleware matcher excludes `/api/auth`, so there is no session check
 * here: the logout token's signature is the authentication.
 *
 * Register the URL with the provider as `backchannel_logout_uri`. Keycloak,
 * Authentik and Zitadel send these; Okta, Google, GitLab and GitHub do not.
 */

/**
 * Every legitimate request comes from the provider's one source address, so
 * they share one bucket and the limit has to clear a whole organisation's
 * sign-outs. Each accepted token costs a discovery fetch and a JWKS fetch, so
 * the limit also stops an unbounded caller flooding the identity provider.
 */
const LOGOUT_LIMIT = 120;
const LOGOUT_WINDOW_MS = 60_000;

/** §2.8: the response must not be cached, whatever the outcome. */
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(req: Request): Promise<Response> {
  const key = `backchannel-logout:${clientKey(req)}`;
  const limited = rateLimit(key, LOGOUT_LIMIT, LOGOUT_WINDOW_MS);
  if (!limited.ok) {
    logRateLimitRejection("backchannel-logout", key);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  // Cookie sessions (local development with the sign-in bypass) can't be
  // reached from outside the browser, so there is nothing to delete.
  if (sessionStrategy() !== "database") {
    return NextResponse.json(
      { error: "not_implemented", error_description: "back-channel logout requires database sessions" },
      { status: 501, headers: NO_STORE },
    );
  }

  // §2.5: the token arrives form-encoded as `logout_token`.
  let logoutToken: string | null;
  try {
    logoutToken = (await req.formData()).get("logout_token") as string | null;
  } catch {
    logoutToken = null;
  }
  if (typeof logoutToken !== "string" || logoutToken === "") {
    return NextResponse.json(
      { error: "invalid_request", error_description: "logout_token is required" },
      { status: 400, headers: NO_STORE },
    );
  }

  let sub: string;
  try {
    ({ sub } = await verifyLogoutToken(logoutToken));
  } catch (e) {
    if (e instanceof LogoutTokenError && e.reason === "idp_unreachable") {
      // The provider retries, and the twelve-hour ceiling is the backstop, but a
      // persistent failure means logout isn't working, so it is logged as an error.
      console.error("[backchannel-logout] cannot verify: identity provider unreachable:", e.message);
      return NextResponse.json(
        { error: "temporarily_unavailable", error_description: "could not reach the identity provider" },
        { status: 503, headers: NO_STORE },
      );
    }
    // A rejected token is a misconfiguration or an attack, and both are worth
    // seeing. `no_subject` is the Ory Hydra shape.
    const reason = e instanceof LogoutTokenError ? e.reason : "invalid_token";
    console.warn(`[backchannel-logout] rejected (${reason}):`, e instanceof Error ? e.message : String(e));
    return NextResponse.json(
      { error: "invalid_request", error_description: `logout token rejected: ${reason}` },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    // Zero rows deleted (nobody signed in here, or they already signed out) is
    // a success too. §2.8 wants a bare 200.
    await deleteSessionsForOidcSubject(sub);
    return new Response(null, { status: 200, headers: NO_STORE });
  } catch (e) {
    console.error("[backchannel-logout] could not end sessions:", e instanceof Error ? e.message : String(e));
    return NextResponse.json(
      { error: "temporarily_unavailable", error_description: "could not end the sessions" },
      { status: 503, headers: NO_STORE },
    );
  }
}
