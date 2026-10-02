import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { LogoutTokenError, verifyLogoutToken } from "@/lib/logout-token";

// Trailing slash on purpose: Authentik advertises `https://…/application/o/<slug>/`
// and signs that exact string into every `iss`.
const ISSUER = "https://idp.test/issuer/";
const CLIENT_ID = "scout";
const JWKS_URI = "https://idp.test/jwks";
const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/**
 * A real keypair and signature against a stubbed JWKS endpoint, so these cases
 * run the same jose verification as production. No IdP is stood up.
 */
let privateKey: CryptoKey;
let publicJwk: Record<string, unknown>;

beforeEach(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: "RS256", use: "sig", kid: "test-key" };

  // biome-ignore lint/complexity/useLiteralKeys: env access
  process.env["OIDC_ISSUER_URL"] = ISSUER;
  // biome-ignore lint/complexity/useLiteralKeys: env access
  process.env["OIDC_CLIENT_ID"] = CLIENT_ID;

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
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(process.env, "OIDC_ISSUER_URL");
  Reflect.deleteProperty(process.env, "OIDC_CLIENT_ID");
});

/** A well-formed logout token, with `overrides` merged over the valid claims. */
async function logoutToken(
  overrides: Record<string, unknown> = {},
  opts: { key?: CryptoKey; alg?: string } = {},
): Promise<string> {
  const claims: Record<string, unknown> = {
    iss: ISSUER,
    aud: CLIENT_ID,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    jti: crypto.randomUUID(),
    sub: "idp-subject-1",
    events: { [BACKCHANNEL_EVENT]: {} },
    ...overrides,
  };
  for (const [k, v] of Object.entries(claims)) if (v === undefined) delete claims[k];
  return new SignJWT(claims)
    .setProtectedHeader({ alg: opts.alg ?? "RS256", kid: "test-key", typ: "logout+jwt" })
    .sign(opts.key ?? privateKey);
}

describe("verifyLogoutToken", () => {
  it("returns the subject of a well-formed token", async () => {
    await expect(verifyLogoutToken(await logoutToken())).resolves.toEqual({ sub: "idp-subject-1" });
  });

  it("accepts an aud array that contains this client", async () => {
    const token = await logoutToken({ aud: ["someone-else", CLIENT_ID] });
    await expect(verifyLogoutToken(token)).resolves.toEqual({ sub: "idp-subject-1" });
  });

  it("matches the issuer the discovery document advertises, trailing slash and all", async () => {
    // `iss` is compared with the issuer exactly as discovery advertises it, not
    // a normalised OIDC_ISSUER_URL.
    await expect(verifyLogoutToken(await logoutToken({ iss: ISSUER }))).resolves.toMatchObject({
      sub: "idp-subject-1",
    });
  });

  it("verifies the same token however the operator typed OIDC_ISSUER_URL", async () => {
    for (const configured of [ISSUER, ISSUER.replace(/\/$/, "")]) {
      // biome-ignore lint/complexity/useLiteralKeys: env access
      process.env["OIDC_ISSUER_URL"] = configured;
      await expect(verifyLogoutToken(await logoutToken())).resolves.toMatchObject({ sub: "idp-subject-1" });
    }
  });

  it("still rejects a token whose iss is the advertised issuer minus its slash", async () => {
    const token = await logoutToken({ iss: ISSUER.replace(/\/$/, "") });
    await expect(verifyLogoutToken(token)).rejects.toMatchObject({ reason: "invalid_token" });
  });

  it("rejects a token signed by a different key", async () => {
    const other = await generateKeyPair("RS256", { extractable: true });
    const token = await logoutToken({}, { key: other.privateKey });
    await expect(verifyLogoutToken(token)).rejects.toMatchObject({ reason: "invalid_token" });
  });

  it("rejects an unsigned token before reaching the network", async () => {
    const claims = { iss: ISSUER, aud: CLIENT_ID, sub: "x", events: { [BACKCHANNEL_EVENT]: {} } };
    const unsecured = [
      Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
      Buffer.from(JSON.stringify(claims)).toString("base64url"),
      "",
    ].join(".");
    await expect(verifyLogoutToken(unsecured)).rejects.toMatchObject({ reason: "invalid_token" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects a token that is not a JWT at all", async () => {
    await expect(verifyLogoutToken("not-a-token")).rejects.toBeInstanceOf(LogoutTokenError);
  });

  it("rejects a token from another issuer", async () => {
    const token = await logoutToken({ iss: "https://evil.test/issuer" });
    await expect(verifyLogoutToken(token)).rejects.toMatchObject({ reason: "invalid_token" });
  });

  it("rejects a token issued for another client", async () => {
    const token = await logoutToken({ aud: "some-other-app" });
    await expect(verifyLogoutToken(token)).rejects.toMatchObject({ reason: "invalid_token" });
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = await logoutToken({ iat: past, exp: past + 60 });
    await expect(verifyLogoutToken(token)).rejects.toMatchObject({ reason: "invalid_token" });
  });

  it("rejects a stale token whose exp is still in the future", async () => {
    // The freshness window is what stops a captured token being replayed hours
    // later by a provider that hands out long-lived exp values.
    const now = Math.floor(Date.now() / 1000);
    const token = await logoutToken({ iat: now - 3600, exp: now + 3600 });
    await expect(verifyLogoutToken(token)).rejects.toMatchObject({ reason: "invalid_token" });
  });

  it("rejects a token with no exp claim", async () => {
    await expect(verifyLogoutToken(await logoutToken({ exp: undefined }))).rejects.toMatchObject({
      reason: "invalid_token",
    });
  });

  it("rejects a token with no jti claim", async () => {
    await expect(verifyLogoutToken(await logoutToken({ jti: undefined }))).rejects.toMatchObject({
      reason: "invalid_token",
    });
  });

  it("rejects a token carrying the prohibited nonce claim", async () => {
    const token = await logoutToken({ nonce: "n-0S6_WzA2Mj" });
    await expect(verifyLogoutToken(token)).rejects.toMatchObject({ reason: "invalid_claims" });
  });

  it("rejects a token whose events claim names a different event", async () => {
    const token = await logoutToken({ events: { "https://schemas.openid.net/secevent/caep/event-type/session-revoked": {} } });
    await expect(verifyLogoutToken(token)).rejects.toMatchObject({ reason: "invalid_claims" });
  });

  it("rejects a token whose events claim is not an object", async () => {
    await expect(verifyLogoutToken(await logoutToken({ events: BACKCHANNEL_EVENT }))).rejects.toMatchObject({
      reason: "invalid_claims",
    });
  });

  it("reports no_subject for a sid-only token rather than failing generically", async () => {
    // Ory Hydra's shape. Its own reason, so the log says why.
    const token = await logoutToken({ sub: undefined, sid: "idp-session-1" });
    await expect(verifyLogoutToken(token)).rejects.toMatchObject({ reason: "no_subject" });
  });

  it("reports idp_unreachable when discovery fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(verifyLogoutToken(await logoutToken())).rejects.toMatchObject({ reason: "idp_unreachable" });
  });

  it("reports idp_unreachable when the issuer publishes no jwks_uri", async () => {
    const token = await logoutToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ issuer: ISSUER, token_endpoint: "https://idp.test/token" }), { status: 200 }),
    );
    await expect(verifyLogoutToken(token)).rejects.toMatchObject({ reason: "idp_unreachable" });
  });

  it("reports idp_unreachable when the discovery document advertises no issuer", async () => {
    const token = await logoutToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ jwks_uri: JWKS_URI }), { status: 200 }),
    );
    await expect(verifyLogoutToken(token)).rejects.toMatchObject({ reason: "idp_unreachable" });
  });
});
