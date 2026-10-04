import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { SCHEMA_VERSION } from "@scoutui/scan-format";

const state = { status: "pending", userId: null as string | null, lastPoll: 0, expiresAt: new Date(Date.now() + 60000) };
vi.mock("@/lib/cli-device-codes", () => ({
  createDeviceCode: vi.fn(async () => ({ deviceCode: "dc-plain", userCode: "ABCD-EFGH" })),
  findByDeviceCodeHash: vi.fn(async () => state.status === "missing" ? null : { id: "d1", status: state.status, approvedUserId: state.userId, expiresAt: state.expiresAt, lastPolledAt: state.lastPoll ? new Date(state.lastPoll) : null }),
  pruneDeviceCodes: vi.fn(async () => {}),
  deleteDeniedDeviceCode: vi.fn(async () => { state.status = "missing"; }),
  touchPoll: vi.fn(async () => { state.lastPoll = Date.now(); }),
}));
vi.mock("@/lib/cli-session-store", () => ({
  consumeApprovedDeviceCode: vi.fn(async () => ({ token: `scout_u_${"a".repeat(43)}`, email: "ben@example.com" })),
}));
vi.mock("@/lib/identity", () => ({
  identify: vi.fn(async (caller: { bearer: string | null }) => caller.bearer === `Bearer scout_u_${"a".repeat(43)}`
    ? { kind: "person", userId: "user-1", email: "ben@example.com", name: null, role: "editor", roleSource: "people" }
    : null),
}));

import { POST as deviceCode } from "@/app/api/auth/cli/device-code/route";
import { POST as token } from "@/app/api/auth/cli/token/route";
import { consumeApprovedDeviceCode } from "@/lib/cli-session-store";
import { createDeviceCode, deleteDeniedDeviceCode, pruneDeviceCodes } from "@/lib/cli-device-codes";
import { hashToken } from "@/lib/cli-session-tokens";

const cliVersion: string = JSON.parse(readFileSync(new URL("../../../../packages/cli/package.json", import.meta.url), "utf8")).version;

const req = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  state.status = "pending"; state.userId = null; state.lastPoll = 0; state.expiresAt = new Date(Date.now() + 60000);
  Reflect.deleteProperty(process.env, "AUTH_URL");
});
afterEach(() => vi.restoreAllMocks());

describe("device flow", () => {
  it("device-code builds verification_uri from AUTH_URL, not the request host (proxy-safe)", async () => {
    // biome-ignore lint/complexity/useLiteralKeys: env access
    process.env["AUTH_URL"] = "https://scout.example.com";
    // Request arrives with the internal pod host (as it does behind the ingress):
    const res = await deviceCode(req("http://scout-abc:3000/api/auth/cli/device-code", {}));
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b.user_code).toBe("ABCD-EFGH");
    expect(b.interval).toBe(5);
    expect(b.verification_uri).toBe("https://scout.example.com/login/device");
    expect(b.verification_uri_complete).toBe("https://scout.example.com/login/device?code=ABCD-EFGH");
    expect(pruneDeviceCodes).toHaveBeenCalledOnce();
  });

  it("device-code falls back to the request origin when AUTH_URL is unset (local dev)", async () => {
    const res = await deviceCode(req("http://localhost:3000/api/auth/cli/device-code", {}));
    const b = await res.json();
    expect(b.verification_uri).toBe("http://localhost:3000/login/device");
  });
  it.each([
    ["newer", SCHEMA_VERSION + 1, `Couldn't sign in: this CLI is newer than the dashboard. Ask your dashboard administrator to upgrade it, or run npx @scoutui/cli@${cliVersion} auth login.`],
    ["older", SCHEMA_VERSION - 1, `Couldn't sign in: this CLI is too old for the dashboard. Upgrade the CLI to ${cliVersion}, or run npx @scoutui/cli@${cliVersion} auth login.`],
  ])("device-code refuses a CLI whose scan format is %s than the dashboard reads, naming the CLI the dashboard was built with", async (_, scanVersion, message) => {
    const res = await deviceCode(req("http://x/api/auth/cli/device-code", { scanVersion }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "unsupported_version", message });
    expect(createDeviceCode).not.toHaveBeenCalled();
  });
  it.each([
    ["a scan format the dashboard reads", { scanVersion: SCHEMA_VERSION }],
    ["no body", undefined],
  ])("device-code starts a login given %s", async (_, body) => {
    const res = await deviceCode(req("http://x/api/auth/cli/device-code", body));
    expect(res.status).toBe(201);
  });
  it("poll is authorization_pending before approval", async () => {
    const res = await token(req("http://x/api/auth/cli/token", { device_code: "dc-plain" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("authorization_pending");
    expect(pruneDeviceCodes).toHaveBeenCalledOnce();
  });
  it("poll returns one durable session credential after approval", async () => {
    state.status = "approved"; state.userId = "user-1";
    const ok = await token(req("http://x/api/auth/cli/token", { device_code: "dc-plain" }));
    expect(ok.status).toBe(200);
    const b = await ok.json();
    expect(b).toEqual({ access_token: `scout_u_${"a".repeat(43)}`, token_type: "Bearer", email: "ben@example.com", role: "editor" });
    expect(b).not.toHaveProperty("refresh_token");
    expect(b).not.toHaveProperty("expires_in");
    expect(consumeApprovedDeviceCode).toHaveBeenCalledWith("d1", "user-1");
    state.status = "consumed";
    const again = await token(req("http://x/api/auth/cli/token", { device_code: "dc-plain" }));
    expect((await again.json()).error).toBe("expired_token");
  });
  it("returns expired_token when another poll consumes the approval first", async () => {
    state.status = "approved"; state.userId = "user-1";
    vi.mocked(consumeApprovedDeviceCode).mockResolvedValueOnce(null);
    const res = await token(req("http://x/api/auth/cli/token", { device_code: "dc-plain" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expired_token" });
  });
  it("slow_down while pending with recent poll", async () => {
    // state.status is "pending" (beforeEach default); set a recent lastPoll (<5s ago)
    state.lastPoll = Date.now();
    const res = await token(req("http://x/api/auth/cli/token", { device_code: "dc-plain" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("slow_down");
  });
  it("denied → access_denied", async () => {
    state.status = "denied";
    const res = await token(req("http://x/api/auth/cli/token", { device_code: "dc-plain" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("access_denied");
    expect(deleteDeniedDeviceCode).toHaveBeenCalledWith("d1");
    const again = await token(req("http://x/api/auth/cli/token", { device_code: "dc-plain" }));
    expect(await again.json()).toEqual({ error: "expired_token" });
  });
  it("returns expired_token for an expired approval", async () => {
    state.status = "approved"; state.userId = "user-1"; state.expiresAt = new Date(Date.now() - 1000);
    const res = await token(req("http://x/api/auth/cli/token", { device_code: "dc-plain" }));
    expect(await res.json()).toEqual({ error: "expired_token" });
    expect(consumeApprovedDeviceCode).not.toHaveBeenCalled();
  });
  it("returns a generic server error when session issuance fails", async () => {
    state.status = "approved"; state.userId = "user-1";
    const raw = "dc-plain";
    const hash = hashToken(raw);
    vi.mocked(consumeApprovedDeviceCode).mockRejectedValueOnce(new DrizzleQueryError("insert session", [hash], new Error(raw)));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await token(req("http://x/api/auth/cli/token", { device_code: raw }));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe('{"error":"server_error"}');
    expect(body).not.toContain(raw);
    expect(body).not.toContain(hash);
    expect(logged).not.toHaveBeenCalled();
  });
  it("returns a generic server error when token lookup fails", async () => {
    const raw = "dc-plain";
    const hash = hashToken(raw);
    vi.mocked(pruneDeviceCodes).mockRejectedValueOnce(new DrizzleQueryError("prune codes", [hash], new Error(raw)));
    const response = await token(req("http://x/api/auth/cli/token", { device_code: raw }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
  });
});
