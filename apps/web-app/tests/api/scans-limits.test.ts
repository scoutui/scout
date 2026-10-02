import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  verifyUploadBearer: vi.fn(async (header: string | null) => {
    if (header === "Bearer ci") return { kind: "ci" as const };
    return { kind: "user" as const, userId: header?.slice("Bearer ".length) ?? "u1" };
  }),
}));
vi.mock("@/db/client", () => ({ getPool: () => ({}) }));
vi.mock("@/lib/scan-jobs", () => ({ uploadQueueFull: vi.fn(async () => false) }));
vi.mock("@/lib/scan-archive", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/scan-archive")>(),
  receiveUpload: vi.fn(),
}));

import { receiveUpload } from "@/lib/scan-archive";

beforeEach(() => {
  vi.mocked(receiveUpload).mockReset().mockImplementation(async (_pool, input) => {
    for await (const _chunk of input) { /* consume */ }
    return { uploadId: "upload-a" };
  });
});

async function loadRoute() {
  vi.resetModules();
  const [route, rl] = await Promise.all([import("@/app/api/scans/route"), import("@/lib/rate-limit")]);
  rl.resetRateLimitState();
  return route.POST;
}

const post = (body: BodyInit, extra: Record<string, string> = {}) =>
  new Request("http://x/api/scans", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer any", ...extra },
    body,
  });

describe("POST /api/scans content encoding", () => {
  it.each([
    [undefined, "identity"], ["identity", "identity"], ["gzip", "gzip"], [" GZIP ", "gzip"],
  ])("accepts content encoding %j as %s", async (header, encoding) => {
    const POST = await loadRoute();
    const res = await POST(post("{}", header === undefined ? {} : { "Content-Encoding": header }));
    expect(res.status).toBe(202);
    expect(vi.mocked(receiveUpload).mock.calls[0]?.[2]).toBe(encoding);
  });

  it.each(["br", "deflate", "gzip, br", "compress"])("rejects content encoding %j with 415 before receiving", async (header) => {
    const POST = await loadRoute();
    const res = await POST(post("{}", { "Content-Encoding": header }));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported content encoding; send gzip or identity" });
    expect(receiveUpload).not.toHaveBeenCalled();
  });
});

describe("POST /api/scans rate limiting", () => {
  it("returns 429 with Retry-After once the ceiling is passed, and logs the key", async () => {
    const POST = await loadRoute();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 30; i++) {
      const res = await POST(post("{}", { Authorization: "Bearer u1" }));
      expect(res.status, `upload ${i}`).toBe(202);
    }
    const blocked = await POST(post("{}", { Authorization: "Bearer u1" }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledWith("[rate-limit] rejected route=scans key=scans:user:u1");
    warn.mockRestore();
  });

  it("buckets signed-in uploads per user, not per address", async () => {
    const POST = await loadRoute();
    const sameAddress = { "X-Forwarded-For": "203.0.113.1" };
    for (let i = 0; i < 30; i++) {
      await POST(post("{}", { ...sameAddress, Authorization: "Bearer u1" }));
    }
    const other = await POST(post("{}", { ...sameAddress, Authorization: "Bearer u2" }));
    expect(other.status).toBe(202);
  });

  it("keeps one user in one bucket across client addresses", async () => {
    const POST = await loadRoute();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 30; i++) {
      await POST(post("{}", { "X-Forwarded-For": `203.0.113.${(i % 5) + 1}`, Authorization: "Bearer u1" }));
    }
    const blocked = await POST(post("{}", { "X-Forwarded-For": "203.0.113.9", Authorization: "Bearer u1" }));
    expect(blocked.status).toBe(429);
    warn.mockRestore();
  });

  it("buckets CI-token uploads per client address", async () => {
    const POST = await loadRoute();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 30; i++) {
      await POST(post("{}", { "X-Forwarded-For": "203.0.113.1", Authorization: "Bearer ci" }));
    }
    const same = await POST(post("{}", { "X-Forwarded-For": "203.0.113.1", Authorization: "Bearer ci" }));
    expect(same.status).toBe(429);
    expect(warn).toHaveBeenCalledWith("[rate-limit] rejected route=scans key=scans:ci:203.0.113.1");
    const other = await POST(post("{}", { "X-Forwarded-For": "203.0.113.2", Authorization: "Bearer ci" }));
    expect(other.status).toBe(202);
    warn.mockRestore();
  });
});

describe("POST /api/scans/preflight rate limiting", () => {
  it("limits a user's pre-scan checks in a bucket apart from their uploads", async () => {
    const upload = await loadRoute();
    const { POST: preflight } = await import("@/app/api/scans/preflight/route");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const check = () => preflight(new Request("http://x/api/scans/preflight", { method: "POST", headers: { Authorization: "Bearer u1" }, body: "{}" }));
    for (let i = 0; i < 30; i++) {
      expect((await check()).status, `check ${i}`).toBe(400);
    }
    const blocked = await check();
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledWith("[rate-limit] rejected route=preflight key=preflight:user:u1");
    expect((await upload(post("{}", { Authorization: "Bearer u1" }))).status).toBe(202);
    warn.mockRestore();
  });

  it("buckets CI-token pre-scan checks per client address", async () => {
    await loadRoute();
    const { POST: preflight } = await import("@/app/api/scans/preflight/route");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const check = (address: string) => preflight(new Request("http://x/api/scans/preflight", {
      method: "POST", headers: { "X-Forwarded-For": address, Authorization: "Bearer ci" }, body: "{}",
    }));
    for (let i = 0; i < 30; i++) {
      await check("203.0.113.1");
    }
    const same = await check("203.0.113.1");
    expect(same.status).toBe(429);
    expect(warn).toHaveBeenCalledWith("[rate-limit] rejected route=preflight key=preflight:ci:203.0.113.1");
    const other = await check("203.0.113.2");
    expect(other.status).toBe(400);
    warn.mockRestore();
  });
});
