import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() })),
}));
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: vi.fn(() => ({})) }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(() => ({})), schema: {} }));
vi.mock("@/lib/auth-providers", () => ({
  buildProviders: vi.fn(() => []),
  isDevAuthEnabled: vi.fn(() => false),
}));

import NextAuth from "next-auth";
import "@/auth";

function authOptions() {
  const options = vi.mocked(NextAuth).mock.calls[0]?.[0];
  if (!options || typeof options === "function") throw new Error("Auth.js was not configured");
  return options;
}

async function oidcSignIn(accessToken?: string, emailVerified = true): Promise<boolean | string> {
  const callback = authOptions().callbacks?.signIn;
  if (!callback) throw new Error("OIDC sign-in callback was not configured");
  return callback({
    user: { id: "u1", email: "alice@example.com" },
    account: {
      provider: "oidc",
      providerAccountId: "sub-1",
      type: "oidc",
      access_token: accessToken,
    },
    profile: { sub: "sub-1", email: "alice@example.com", email_verified: emailVerified },
  } as Parameters<typeof callback>[0]);
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("SCOUTUI_REQUIRED_GROUP", "scout-users");
  vi.stubEnv("OIDC_ALLOWED_DOMAINS", "");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("OIDC sign-in", () => {
  it("routes a denied sign-in back to the retryable login page", () => {
    expect(authOptions().pages).toMatchObject({ signIn: "/login", error: "/login" });
  });

  it("denies sign-in when a configured group cannot be checked without an access token", async () => {
    await expect(oidcSignIn()).resolves.toBe(false);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[auth] sign-in denied for alice@example.com: the identity provider sent no access token, so membership of SCOUTUI_REQUIRED_GROUP (scout-users) couldn't be checked",
    );
  });

  it("logs why the domain gate denied sign-in", async () => {
    vi.stubEnv("OIDC_ALLOWED_DOMAINS", "example.org");
    await expect(oidcSignIn("idp-token")).resolves.toBe(false);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[auth] sign-in denied for alice@example.com: the email domain example.com isn't in OIDC_ALLOWED_DOMAINS",
    );
  });

  it("logs an unverified address before checking the domain", async () => {
    vi.stubEnv("OIDC_ALLOWED_DOMAINS", "example.com");
    await expect(oidcSignIn("idp-token", false)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("didn't mark the email address as verified"));
  });

  it("keeps the user signed out with a retry message when userinfo is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes(".well-known")) {
        return new Response(JSON.stringify({ userinfo_endpoint: "https://idp.test/userinfo" }));
      }
      return new Response("unavailable", { status: 503 });
    });
    vi.stubEnv("OIDC_ISSUER_URL", "https://idp.test/issuer");
    await expect(oidcSignIn("idp-token")).resolves.toBe("/login?error=AccessCheckUnavailable");
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[auth] sign-in denied for alice@example.com: couldn't read groups from the identity provider (userinfo 503), so membership of SCOUTUI_REQUIRED_GROUP (scout-users) couldn't be checked",
    );
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("idp-token");
  });

  it.each([
    ["invalid JSON", "{", "/login?error=AccessCheckUnavailable"],
    ["a malformed groups field", JSON.stringify({ sub: "u1", groups: "scout-users" }), false],
    ["a confirmed missing group", JSON.stringify({ sub: "u1", groups: ["other"] }), false],
  ])("denies sign-in when userinfo contains %s", async (_case, body, outcome) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes(".well-known")) {
        return new Response(JSON.stringify({ userinfo_endpoint: "https://idp.test/userinfo" }));
      }
      return new Response(body);
    });
    vi.stubEnv("OIDC_ISSUER_URL", "https://idp.test/issuer");
    await expect(oidcSignIn("idp-token")).resolves.toBe(outcome);
  });

  it("keeps the user signed out with a retry message when the userinfo fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes(".well-known")) {
        return new Response(JSON.stringify({ userinfo_endpoint: "https://idp.test/userinfo" }));
      }
      throw new TypeError("network unavailable");
    });
    vi.stubEnv("OIDC_ISSUER_URL", "https://idp.test/issuer");
    await expect(oidcSignIn("idp-token")).resolves.toBe("/login?error=AccessCheckUnavailable");
  });

  it("allows sign-in without an IdP access token when no group is configured", async () => {
    vi.stubEnv("SCOUTUI_REQUIRED_GROUP", "");
    await expect(oidcSignIn()).resolves.toBe(true);
  });

  it("logs a confirmed missing group", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes(".well-known")) {
        return new Response(JSON.stringify({ userinfo_endpoint: "https://idp.test/userinfo" }));
      }
      return new Response(JSON.stringify({ sub: "u1", groups: ["other"] }));
    });
    vi.stubEnv("OIDC_ISSUER_URL", "https://idp.test/issuer");
    await expect(oidcSignIn("idp-token")).resolves.toBe(false);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[auth] sign-in denied for alice@example.com: the account isn't in SCOUTUI_REQUIRED_GROUP (scout-users)",
    );
  });

  it("allows sign-in when userinfo confirms the required group", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes(".well-known")) {
        return new Response(JSON.stringify({ userinfo_endpoint: "https://idp.test/userinfo" }));
      }
      return new Response(JSON.stringify({ sub: "u1", groups: ["scout-users"] }));
    });
    vi.stubEnv("OIDC_ISSUER_URL", "https://idp.test/issuer");
    await expect(oidcSignIn("idp-token")).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
