import { describe, it, expect, vi, afterEach } from "vitest";
import {
  requestDeviceCode,
  pollToken,
  revokeSession,
  whoami,
  AuthHttpError,
  AuthProtocolError,
} from "../../../src/auth/client.js";

const BASE = "https://h.example";
const USER_TOKEN = `scout_u_${"a".repeat(43)}`;
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}
afterEach(() => vi.restoreAllMocks());

describe("requestDeviceCode", () => {
  it("maps the snake_case response to camelCase", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse(
        {
          device_code: "dc",
          user_code: "ABCD-EFGH",
          verification_uri: "https://h.example/login/device",
          verification_uri_complete: "https://h.example/login/device?code=ABCD-EFGH",
          expires_in: 600,
          interval: 5,
        },
        201,
      ),
    );
    const r = await requestDeviceCode(BASE);
    expect(r).toEqual({
      deviceCode: "dc",
      userCode: "ABCD-EFGH",
      verificationUri: "https://h.example/login/device",
      verificationUriComplete: "https://h.example/login/device?code=ABCD-EFGH",
      expiresIn: 600,
      interval: 5,
      warning: null,
    });
  });

  it("throws AuthHttpError on a non-OK response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error: "server_error" }, 500));
    await expect(requestDeviceCode(BASE)).rejects.toBeInstanceOf(AuthHttpError);
  });
});

describe("pollToken", () => {
  it("returns one user session on 200", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse(
        { access_token: USER_TOKEN, token_type: "Bearer", email: "ben@example.com" },
        200,
      ),
    );
    const r = await pollToken(BASE, "dc");
    expect(r).toEqual({
      kind: "session",
      session: { token: USER_TOKEN, email: "ben@example.com" },
    });
  });

  it.each([
    ["null", null],
    ["empty object", {}],
    ["legacy token", { access_token: "eyJ.eyJ.signature", token_type: "Bearer", email: "ben@example.com" }],
    ["refresh token", { access_token: `cc_r_${"a".repeat(43)}`, token_type: "Bearer", email: "ben@example.com" }],
    ["short user token", { access_token: "scout_u_short", token_type: "Bearer", email: "ben@example.com" }],
    ["wrong token type", { access_token: USER_TOKEN, token_type: "bearer", email: "ben@example.com" }],
    ["missing email", { access_token: USER_TOKEN, token_type: "Bearer" }],
    ["invalid email", { access_token: USER_TOKEN, token_type: "Bearer", email: 12 }],
  ])("rejects malformed successful token response (%s)", async (_label, body) => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(body, 200));
    await expect(pollToken(BASE, "dc")).rejects.toBeInstanceOf(AuthProtocolError);
  });

  it("rejects invalid JSON in a successful token response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("not JSON", { status: 200 }));
    await expect(pollToken(BASE, "dc")).rejects.toBeInstanceOf(AuthProtocolError);
  });

  it.each([
    ["authorization_pending", "pending"],
    ["slow_down", "slow_down"],
    ["expired_token", "expired"],
    ["access_denied", "denied"],
  ])("maps 400 %s to %s", async (error, kind) => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error }, 400));
    expect((await pollToken(BASE, "dc")).kind).toBe(kind);
  });

  it("throws AuthHttpError on an unrecognised error code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error: "weird_unknown" }, 400));
    await expect(pollToken(BASE, "dc")).rejects.toBeInstanceOf(AuthHttpError);
  });
});

describe("revokeSession", () => {
  it("deletes the selected remote session and accepts 204", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(revokeSession(BASE, "scout_u_abc")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/auth/cli/session`, {
      method: "DELETE", headers: { Authorization: "Bearer scout_u_abc" },
    });
  });

  it.each([401, 500])("rejects HTTP %i revocation", async (status) => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error: "failed" }, status));
    await expect(revokeSession(BASE, "scout_u_abc")).rejects.toMatchObject({ status });
  });

  it("preserves transport failures", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(revokeSession(BASE, "scout_u_abc")).rejects.toThrow("fetch failed");
  });
});

describe("whoami", () => {
  it("returns identity on 200", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ userId: "u1", email: "ben@example.com" }, 200));
    expect(await whoami(BASE, "a")).toEqual({ userId: "u1", email: "ben@example.com" });
  });
  it("returns null on 401", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));
    expect(await whoami(BASE, "a")).toBeNull();
  });

  it.each([
    ["null", null],
    ["missing user ID", { email: "ben@example.com" }],
    ["invalid email", { userId: "u1", email: 123 }],
  ])("rejects a malformed 200 identity (%s)", async (_label, body) => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(body, 200));
    await expect(whoami(BASE, "a")).rejects.toThrow(/invalid whoami response/i);
  });

  it("rejects invalid JSON in a successful response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("not JSON", { status: 200 }));
    await expect(whoami(BASE, "a")).rejects.toThrow(/invalid whoami response/i);
  });

  it("throws AuthHttpError on a non-401 non-OK response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error: "server_error" }, 500));
    await expect(whoami(BASE, "a")).rejects.toBeInstanceOf(AuthHttpError);
  });
});
