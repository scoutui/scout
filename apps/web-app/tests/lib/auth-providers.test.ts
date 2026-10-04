import { describe, it, expect, vi, beforeEach } from "vitest";
import * as realSchema from "@/db/schema";
import { buildProviders, isDevAuthEnabled, isOidcConfigured } from "@/lib/auth-providers";

const mockFindFirstUsers = vi.fn();
const mockInsertValues = vi.fn();
const mockUpdateSet = vi.fn();

const mockDb = {
  query: { users: { findFirst: mockFindFirstUsers } },
  insert: () => ({
    values: (v: { id: string }) => {
      mockInsertValues(v);
      return { returning: async () => [{ id: v.id }] };
    },
  }),
  update: () => ({
    set: (v: Record<string, unknown>) => {
      mockUpdateSet(v);
      return { where: async () => {} };
    },
  }),
};

vi.mock("@/db/client", () => ({
  getDb: () => mockDb,
  // Export the real schema so column reference objects (used in eq) resolve correctly.
  schema: realSchema,
}));

const OIDC = {
  OIDC_ISSUER_URL: "https://auth.example.com/",
  OIDC_CLIENT_ID: "client-id",
  OIDC_CLIENT_SECRET: "client-secret",
};

// The OIDC entry is a plain object literal (type "oidc"); the dev entry is an
// Auth.js Credentials provider (type "credentials"). Assert on `type`: the dev
// provider's `id: "dev"` is only applied during Auth.js normalization.
function kinds(providers: ReturnType<typeof buildProviders>): string[] {
  return providers.map((p) => (p as { type: string }).type);
}

describe("buildProviders", () => {
  it("requires OIDC in production", () => {
    expect(() => buildProviders({ NODE_ENV: "production" })).toThrow(/OIDC_ISSUER_URL is required/);
  });

  it("wires up only OIDC in production when configured", () => {
    const providers = buildProviders({ NODE_ENV: "production", ...OIDC });
    expect(kinds(providers)).toEqual(["oidc"]);
  });

  it("requests only the scopes needed for browser sign-in", () => {
    const [provider] = buildProviders({ NODE_ENV: "production", ...OIDC });
    expect(provider).toMatchObject({
      authorization: { params: { scope: "openid profile email" } },
    });
  });

  it("allows the dev bypass to run without any OIDC config", () => {
    const env = { NODE_ENV: "development", DEV_AUTH_PASSWORD: "hunter2" };
    expect(() => buildProviders(env)).not.toThrow();
    expect(kinds(buildProviders(env))).toEqual(["credentials"]);
  });

  it("wires up both providers in dev when OIDC is also configured", () => {
    const providers = buildProviders({
      NODE_ENV: "development",
      DEV_AUTH_PASSWORD: "hunter2",
      ...OIDC,
    });
    expect(kinds(providers)).toEqual(["oidc", "credentials"]);
  });

  it("still requires OIDC in dev when the bypass is off", () => {
    // Matches the documented `.env.local.example` contract: leaving
    // DEV_AUTH_PASSWORD empty means real OIDC is required, even in dev.
    expect(() => buildProviders({ NODE_ENV: "development" })).toThrow(/OIDC_ISSUER_URL is required/);
  });

  it("does not throw for missing OIDC during the production build phase", () => {
    expect(() =>
      buildProviders({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }),
    ).not.toThrow();
  });
});

describe("dev sign-in persistence", () => {
  // Device approval, CLI tokens, and scan rows all FK to `user`; a JWT-only
  // Credentials identity never reaches the adapter, so authorize itself must
  // guarantee the row exists.
  type Creds = Record<string, unknown>;
  type AuthResult = { id: string; email: string; name: string | null } | null;

  function devAuthorize(): (creds: Creds) => Promise<AuthResult> {
    const providers = buildProviders({ NODE_ENV: "development", DEV_AUTH_PASSWORD: "hunter2" });
    const dev = providers.find((p) => (p as { type: string }).type === "credentials") as unknown as {
      authorize?: (creds: Creds) => Promise<AuthResult>;
      options?: { authorize: (creds: Creds) => Promise<AuthResult> };
    };
    const authorize = dev.options?.authorize ?? dev.authorize;
    if (!authorize) throw new Error("dev provider has no authorize");
    return authorize;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirstUsers.mockResolvedValue(undefined);
  });

  it("creates a users row for a first-time dev sign-in, as an Admin when no role is given", async () => {
    const user = await devAuthorize()({ email: "you@example.com", password: "hunter2" });
    expect(user).toEqual({ id: "dev-you@example.com", email: "you@example.com", name: "you" });
    expect(mockInsertValues).toHaveBeenCalledWith({
      id: "dev-you@example.com",
      email: "you@example.com",
      name: "you",
      role: "admin",
    });
  });

  it("reuses the existing users row when the email is already registered, and stores the chosen role", async () => {
    mockFindFirstUsers.mockResolvedValue({ id: "uuid-1", name: "Real Name" });
    const user = await devAuthorize()({ email: "you@example.com", password: "hunter2", role: "viewer" });
    expect(user).toEqual({ id: "uuid-1", email: "you@example.com", name: "Real Name" });
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledExactlyOnceWith({ role: "viewer" });
  });

  it("does not touch the database when the credentials are rejected", async () => {
    const user = await devAuthorize()({ email: "you@example.com", password: "wrong" });
    expect(user).toBeNull();
    expect(mockFindFirstUsers).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });
});

describe("isDevAuthEnabled", () => {
  it("is true only in development with a password set", () => {
    expect(isDevAuthEnabled({ NODE_ENV: "development", DEV_AUTH_PASSWORD: "x" })).toBe(true);
    expect(isDevAuthEnabled({ NODE_ENV: "development", DEV_AUTH_PASSWORD: "" })).toBe(false);
    expect(isDevAuthEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(isDevAuthEnabled({ NODE_ENV: "production", DEV_AUTH_PASSWORD: "x" })).toBe(false);
  });
});

describe("isOidcConfigured", () => {
  it("tracks presence of the issuer URL", () => {
    expect(isOidcConfigured({ OIDC_ISSUER_URL: "https://auth.example.com/" })).toBe(true);
    expect(isOidcConfigured({})).toBe(false);
  });
});
