import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const verify = { impl: null as null | (() => Promise<{ sub: string }>) };
vi.mock("@/lib/logout-token", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logout-token")>("@/lib/logout-token");
  return {
    ...actual,
    verifyLogoutToken: vi.fn(async () => (verify.impl ? verify.impl() : { sub: "idp-subject-1" })),
  };
});

const store = { deleted: 0, fail: false };
vi.mock("@/lib/browser-session-store", () => ({
  deleteSessionsForOidcSubject: vi.fn(async () => {
    if (store.fail) throw new Error("connection refused");
    return store.deleted;
  }),
}));

const strategy = { value: "database" as "database" | "jwt" };
vi.mock("@/lib/auth-session", () => ({ sessionStrategy: () => strategy.value }));

import { POST } from "@/app/api/auth/backchannel-logout/route";
import { deleteSessionsForOidcSubject } from "@/lib/browser-session-store";
import { LogoutTokenError } from "@/lib/logout-token";
import { resetRateLimitState } from "@/lib/rate-limit";

const req = (fields: Record<string, string> = { logout_token: "a.b.c" }, ip = "10.0.0.1") =>
  new Request("http://x/api/auth/backchannel-logout", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
    body: new URLSearchParams(fields),
  });

beforeEach(() => {
  verify.impl = null;
  store.deleted = 1;
  store.fail = false;
  strategy.value = "database";
  resetRateLimitState();
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/auth/backchannel-logout", () => {
  it("ends the subject's sessions and returns a bare 200", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(deleteSessionsForOidcSubject).toHaveBeenCalledWith("idp-subject-1");
  });

  it("never caches the response", async () => {
    expect((await POST(req())).headers.get("Cache-Control")).toBe("no-store");
  });

  it("400s when the form carries no logout_token", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(deleteSessionsForOidcSubject).not.toHaveBeenCalled();
  });

  it("400s on a body that is not a form at all", async () => {
    const res = await POST(
      new Request("http://x/api/auth/backchannel-logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400s and logs when the token fails verification", async () => {
    verify.impl = async () => {
      throw new LogoutTokenError("invalid_token", "signature did not verify");
    };
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(console.warn).toHaveBeenCalled();
    expect(deleteSessionsForOidcSubject).not.toHaveBeenCalled();
  });

  it("400s on a sid-only token, naming the reason", async () => {
    verify.impl = async () => {
      throw new LogoutTokenError("no_subject", "logout token carries no sub claim");
    };
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect((await res.json()).error_description).toContain("no_subject");
  });

  it("503s and logs loudly when the identity provider is unreachable", async () => {
    verify.impl = async () => {
      throw new LogoutTokenError("idp_unreachable", "discovery 500");
    };
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(console.error).toHaveBeenCalled();
  });

  it("503s and logs loudly when the sessions cannot be deleted", async () => {
    store.fail = true;
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("temporarily_unavailable");
    expect(console.error).toHaveBeenCalled();
  });

  it("501s under cookie sessions, without touching the token", async () => {
    strategy.value = "jwt";
    const res = await POST(req());
    expect(res.status).toBe(501);
    expect(deleteSessionsForOidcSubject).not.toHaveBeenCalled();
  });

  it("rate-limits a flood from one source and says when to retry", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 130; i++) last = await POST(req());
    // biome-ignore lint/style/noNonNullAssertion: the loop always runs
    expect(last!.status).toBe(429);
    // biome-ignore lint/style/noNonNullAssertion: the loop always runs
    expect(Number(last!.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("clears a whole organisation's sign-outs before limiting", async () => {
    for (let i = 0; i < 100; i++) expect((await POST(req())).status).toBe(200);
  });
});
