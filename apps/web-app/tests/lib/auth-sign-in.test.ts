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
vi.mock("@/lib/people", () => ({ recordSignIn: vi.fn() }));

import NextAuth from "next-auth";
import "@/auth";
import { recordSignIn } from "@/lib/people";

function authOptions() {
  const options = vi.mocked(NextAuth).mock.calls[0]?.[0];
  if (!options || typeof options === "function") throw new Error("Auth.js was not configured");
  return options;
}

async function oidcSignIn(emailVerified = true, providerEmail = "alice@example.com"): Promise<boolean | string> {
  const callback = authOptions().callbacks?.signIn;
  if (!callback) throw new Error("OIDC sign-in callback was not configured");
  return callback({
    user: { id: "u1", email: "alice@example.com" },
    account: { provider: "oidc", providerAccountId: "sub-1", type: "oidc" },
    profile: { sub: "sub-1", email: providerEmail, email_verified: emailVerified },
  } as Parameters<typeof callback>[0]);
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
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

  it("logs why the domain gate denied sign-in", async () => {
    vi.stubEnv("OIDC_ALLOWED_DOMAINS", "example.org");
    await expect(oidcSignIn()).resolves.toBe(false);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[auth] sign-in denied for alice@example.com: the email domain example.com isn't in OIDC_ALLOWED_DOMAINS",
    );
  });

  it("logs an unverified address before checking the domain", async () => {
    vi.stubEnv("OIDC_ALLOWED_DOMAINS", "example.com");
    await expect(oidcSignIn(false)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("didn't mark the email address as verified"));
  });

  it.each([
    { case: "allows a verified email that matches the one on record in another letter case", providerEmail: "Alice@Example.com", outcome: true },
    { case: "refuses a verified email that isn't the one on record", providerEmail: "mallory@example.org", outcome: false },
  ])("$case", async ({ providerEmail, outcome }) => {
    vi.stubEnv("OIDC_ALLOWED_DOMAINS", "example.com");
    await expect(oidcSignIn(true, providerEmail)).resolves.toBe(outcome);
  });
});

describe("recording a sign-in", () => {
  it.each([
    {
      case: "an OIDC email the provider verified, in another letter case",
      account: { provider: "oidc", providerAccountId: "sub-1", type: "oidc", access_token: "idp-token" },
      profile: { sub: "sub-1", email: "Alice@Example.com", email_verified: true },
      accessToken: "idp-token",
      emailVerified: true,
    },
    {
      case: "a verified OIDC email that isn't the stored one",
      account: { provider: "oidc", providerAccountId: "sub-1", type: "oidc", access_token: "idp-token" },
      profile: { sub: "sub-1", email: "mallory@example.com", email_verified: true },
      accessToken: "idp-token",
      emailVerified: false,
    },
    {
      case: "a dev sign-in, which has no profile",
      account: { provider: "dev", providerAccountId: "u1", type: "credentials" },
      profile: undefined,
      accessToken: undefined,
      emailVerified: false,
    },
  ])("records $case as verified: $emailVerified", async ({ account, profile, accessToken, emailVerified }) => {
    vi.mocked(recordSignIn).mockClear();
    const event = authOptions().events?.signIn;
    if (!event) throw new Error("The sign-in event was not configured");
    await event({ user: { id: "u1", email: "alice@example.com" }, account, profile } as Parameters<typeof event>[0]);
    expect(recordSignIn).toHaveBeenCalledExactlyOnceWith({
      userId: "u1", email: "alice@example.com", provider: account.provider, emailVerified, accessToken,
    });
  });
});
