/**
 * Verification for the logout token a provider POSTs at back-channel logout
 * (OIDC Back-Channel Logout 1.0 §2.6).
 *
 * A logout token is not an ID token and never proves authentication: it
 * prohibits `nonce`, carries an `events` claim, and says nothing about why it
 * was sent, so it ends browser sessions only, never a CLI session.
 */

import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { discoverIssuerMetadata } from "@/lib/idp-refresh";

/** §2.4: the one event a logout token's `events` claim must carry. */
const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/**
 * How stale an `iat` may be (§2.6 asks only that the token be "recent"). Wide
 * enough for a provider retrying a failed delivery, narrow enough that a token
 * captured off the wire is useless by the time it is replayed. There is no `jti`
 * replay cache: a replay only re-deletes sessions that are already gone.
 */
const MAX_TOKEN_AGE_SECONDS = 300;

/** Clock drift allowed between the provider's clock and ours. */
const CLOCK_TOLERANCE_SECONDS = 30;

export type LogoutTokenRejection =
  /** Unparseable, unsigned (`alg: none`), or the signature did not verify. */
  | "invalid_token"
  /** Parsed and signed, but a claim required by §2.4/§2.6 is wrong or missing. */
  | "invalid_claims"
  /** Valid but carries only `sid` (Ory Hydra's shape). */
  | "no_subject"
  /** The issuer's discovery document or JWKS could not be reached. */
  | "idp_unreachable";

export class LogoutTokenError extends Error {
  constructor(
    public reason: LogoutTokenRejection,
    message: string,
  ) {
    super(message);
    this.name = "LogoutTokenError";
  }
}

/** Only the audience comes from configuration; the issuer comes from discovery
 * (see below). */
function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new LogoutTokenError("idp_unreachable", `${name} is required`);
  return v;
}

/**
 * The subject a valid logout token names, or a `LogoutTokenError` saying which
 * check it failed.
 *
 * Matches on `sub` only, so every browser session for that person ends. Matching
 * on `sid` would end only the browser whose IdP session ended.
 */
export async function verifyLogoutToken(token: string): Promise<{ sub: string }> {
  // §2.6: reject an unsecured token first. A JWKS lookup would fail on
  // `alg: none` anyway, but reading the header saves a round trip to the provider.
  let alg: string;
  try {
    alg = decodeProtectedHeader(token).alg ?? "none";
  } catch (e) {
    throw new LogoutTokenError("invalid_token", `unparseable logout token: ${String(e)}`);
  }
  if (alg === "none") throw new LogoutTokenError("invalid_token", "logout token is unsigned");

  // The issuer comes from the discovery document, not from OIDC_ISSUER_URL.
  // Authentik advertises `https://…/application/o/<slug>/` with the trailing
  // slash and signs that exact string into every `iss`, so an issuer rebuilt
  // from configuration rejects every token the provider sends.
  let metadata: { issuer: string; jwksUri: string };
  try {
    metadata = await discoverIssuerMetadata();
  } catch (e) {
    throw new LogoutTokenError("idp_unreachable", `could not read issuer metadata: ${String(e)}`);
  }

  // Built per call, so the JWKS is refetched on every logout (`createRemoteJWKSet`
  // caches keys only within one instance). The route's rate limit bounds traffic
  // to the provider.
  const jwks = createRemoteJWKSet(new URL(metadata.jwksUri));

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: metadata.issuer,
      audience: env("OIDC_CLIENT_ID"),
      // §2.4 fixes the claim set. Requiring `exp` stops a provider slipping an
      // indefinitely valid token past the freshness window, which measures
      // against `iat`.
      requiredClaims: ["iss", "aud", "iat", "exp", "jti", "events"],
      maxTokenAge: MAX_TOKEN_AGE_SECONDS,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    }));
  } catch (e) {
    // jose throws the same way for a bad signature and a bad claim; the route
    // logs the message, which tells them apart.
    throw new LogoutTokenError("invalid_token", `logout token failed verification: ${String(e)}`);
  }

  // §2.6: a logout token that carries `nonce` is an ID token being replayed as one.
  if ("nonce" in payload) {
    throw new LogoutTokenError("invalid_claims", "logout token carries a prohibited nonce claim");
  }

  // biome-ignore lint/complexity/useLiteralKeys: not a declared JWTPayload claim
  const events = payload["events"];
  if (typeof events !== "object" || events === null || !(BACKCHANNEL_LOGOUT_EVENT in events)) {
    throw new LogoutTokenError("invalid_claims", "events claim does not declare a back-channel logout");
  }

  const sub = payload.sub;
  if (typeof sub !== "string" || sub === "") {
    throw new LogoutTokenError("no_subject", "logout token carries no sub claim");
  }
  return { sub };
}
