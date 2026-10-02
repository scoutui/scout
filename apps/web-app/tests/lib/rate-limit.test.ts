import { describe, it, expect, beforeEach, vi } from "vitest";
import { rateLimit, clientKey, logRateLimitRejection, resetRateLimitState } from "@/lib/rate-limit";

beforeEach(() => resetRateLimitState());

const req = (headers: Record<string, string>) => new Request("https://x.test/", { headers });

describe("rateLimit", () => {
  it("allows up to the limit and rejects the next hit", () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("k", 3, 1000, 1000).ok, `hit ${i}`).toBe(true);
    }
    expect(rateLimit("k", 3, 1000, 1000).ok).toBe(false);
  });

  it("frees budget once hits fall outside the window", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", 3, 1000, 1000);
    expect(rateLimit("k", 3, 1000, 1500).ok).toBe(false);
    // 1000 + 1000 = 2000, so at 2001 the original hits are outside the window.
    expect(rateLimit("k", 3, 1000, 2001).ok).toBe(true);
  });

  it("keys independently", () => {
    for (let i = 0; i < 3; i++) rateLimit("a", 3, 1000, 1000);
    expect(rateLimit("a", 3, 1000, 1000).ok).toBe(false);
    expect(rateLimit("b", 3, 1000, 1000).ok).toBe(true);
  });

  it("reports how long to wait", () => {
    for (let i = 0; i < 2; i++) rateLimit("k", 2, 10_000, 1000);
    const r = rateLimit("k", 2, 10_000, 4000);
    expect(r.ok).toBe(false);
    // oldest hit at 1000, window 10s, now 4000 -> 7s remaining
    if (!r.ok) expect(r.retryAfterSeconds).toBe(7);
  });

  it("a rejected hit does not extend the block", () => {
    // Rejected attempts must not be recorded, or a caller hammering the
    // endpoint would keep pushing its own unblock time back indefinitely.
    rateLimit("k", 1, 1000, 1000);
    for (let t = 1100; t < 1900; t += 100) rateLimit("k", 1, 1000, t);
    expect(rateLimit("k", 1, 1000, 2001).ok).toBe(true);
  });
});

describe("clientKey", () => {
  it("takes the rightmost x-forwarded-for entry, not the client-supplied left", () => {
    // The ingress appends the peer it saw, and a client's own XFF stays on the
    // left: keying on that would hand an attacker a fresh bucket per request.
    expect(clientKey(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("handles a single entry and stray whitespace", () => {
    expect(clientKey(req({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientKey(req({ "x-forwarded-for": " 203.0.113.7 , 198.51.100.2 " }))).toBe("198.51.100.2");
  });

  it.each([
    ["one hop by default", {}, "203.0.113.7"],
    ["two hops: a load balancer in front of the ingress", { SCOUTUI_TRUSTED_PROXY_HOPS: "2" }, "198.51.100.2"],
    ["more hops than entries: the leftmost", { SCOUTUI_TRUSTED_PROXY_HOPS: "5" }, "9.9.9.9"],
  ])("with %s, keys on the client the trusted proxies saw", (_label, env, key) => {
    const forwarded = req({ "x-forwarded-for": "9.9.9.9, 198.51.100.2, 203.0.113.7" });
    expect(clientKey(forwarded, env)).toBe(key);
  });

  it("falls back to x-real-ip, then a constant", () => {
    expect(clientKey(req({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientKey(req({}))).toBe("unknown");
  });
});

describe("logRateLimitRejection", () => {
  it("writes one line naming the route and the derived key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logRateLimitRejection("scans", "scans:user:u1");
    expect(warn).toHaveBeenCalledWith("[rate-limit] rejected route=scans key=scans:user:u1");
    warn.mockRestore();
  });
});
