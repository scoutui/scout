import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/cli-device-codes", () => ({
  createDeviceCode: vi.fn(async () => ({ deviceCode: "dc-plain", userCode: "ABCD-EFGH" })),
  findByDeviceCodeHash: vi.fn(async () => null),
  pruneDeviceCodes: vi.fn(async () => {}),
  deleteDeniedDeviceCode: vi.fn(async () => {}),
  touchPoll: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ verifyUploadBearer: vi.fn(async () => ({ kind: "user", userId: "u1" })) }));

import { POST as deviceCode } from "@/app/api/auth/cli/device-code/route";
import { POST as token } from "@/app/api/auth/cli/token/route";
import { POST as preflight } from "@/app/api/scans/preflight/route";
import { resetRateLimitState } from "@/lib/rate-limit";

const ADDRESS = "203.0.113.7";
const post = (path: string) =>
  new Request(`http://x${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ADDRESS },
    body: "{}",
  });

afterEach(() => {
  resetRateLimitState();
  vi.restoreAllMocks();
});

describe("per-address ceilings on the CLI sign-in routes", () => {
  it("device-code accepts 100 per address per window, then rejects with 429", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 100; i++) {
      const res = await deviceCode(post("/api/auth/cli/device-code"));
      expect(res.status, `request ${i}`).toBe(201);
    }
    const blocked = await deviceCode(post("/api/auth/cli/device-code"));
    expect(blocked.status).toBe(429);
    expect(warn).toHaveBeenCalledWith(`[rate-limit] rejected route=device-code key=device-code:${ADDRESS}`);
  });

  it("token polling accepts 2400 per address per window, then answers slow_down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 2400; i++) {
      const res = await token(post("/api/auth/cli/token"));
      expect((await res.json()).error, `request ${i}`).toBe("invalid_request");
    }
    const blocked = await token(post("/api/auth/cli/token"));
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).error).toBe("slow_down");
  });
});

describe("request body limits on the CLI routes", () => {
  const sized = (bytes: number) => `{"pad":"${"x".repeat(bytes - '{"pad":""}'.length)}"}`;
  const request = (path: string, body: string, headers: Record<string, string> = {}) =>
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer u1", "x-forwarded-for": ADDRESS, ...headers },
      body,
    });

  it.each([
    ["device-code", deviceCode, "/api/auth/cli/device-code", 4096, 201],
    ["token", token, "/api/auth/cli/token", 4096, 400],
    ["the pre-scan check", preflight, "/api/scans/preflight", 65536, 400],
  ])("%s reads a body at its limit and refuses one byte more with 413", async (_, route, path, limit, atLimitStatus) => {
    expect((await route(request(path, sized(limit)))).status).toBe(atLimitStatus);
    const refused = await route(request(path, sized(limit + 1)));
    expect(refused.status).toBe(413);
    expect(await refused.json()).toEqual({ error: `payload too large (limit ${limit} bytes)` });
  });

  it("refuses a body whose declared length is over the limit, however short it is", async () => {
    const refused = await deviceCode(request("/api/auth/cli/device-code", "{}", { "Content-Length": "4097" }));
    expect(refused.status).toBe(413);
  });
});
