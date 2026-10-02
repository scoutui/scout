import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config";

// Security controls expressed as configuration, which nothing else in the
// suite observes.
describe("security headers", () => {
  it("applies the header set to every path", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toHaveLength(1);
    expect(rules?.[0]?.source).toBe("/:path*");
  });

  it("sets each expected header", async () => {
    const rules = await nextConfig.headers?.();
    const got = Object.fromEntries((rules?.[0]?.headers ?? []).map((h) => [h.key, h.value]));

    expect(got["X-Content-Type-Options"]).toBe("nosniff");
    expect(got["X-Frame-Options"]).toBe("DENY");
    expect(got["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(got["Permissions-Policy"]).toContain("camera=()");
    expect(got["Strict-Transport-Security"]).toContain("max-age=");
  });

  it("leaves out the X-Powered-By header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("does not submit the domain to the HSTS preload list", async () => {
    // `preload` is effectively irreversible and is the operator's call, not a
    // default shipped to every self-hoster.
    const rules = await nextConfig.headers?.();
    const hsts = (rules?.[0]?.headers ?? []).find((h) => h.key === "Strict-Transport-Security");
    expect(hsts?.value).not.toContain("preload");
  });
});
