import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, newNonce } from "@/lib/content-security-policy";

const directives = (policy: string) =>
  Object.fromEntries(policy.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1).join(" ")]));

describe("contentSecurityPolicy", () => {
  it("allows scripts only with the request's nonce, and blocks other origins and framing", () => {
    expect(directives(contentSecurityPolicy("abc123", { dev: false }))).toEqual({
      "default-src": "'self'",
      "script-src": "'self' 'nonce-abc123' 'strict-dynamic'",
      "style-src": "'self' 'unsafe-inline'",
      "img-src": "'self' data: blob:",
      "font-src": "'self'",
      "connect-src": "'self'",
      "form-action": "'self'",
      "object-src": "'none'",
      "base-uri": "'self'",
      "frame-ancestors": "'none'",
    });
  });

  it("allows eval only in development", () => {
    expect(directives(contentSecurityPolicy("n", { dev: true }))["script-src"]).toContain("'unsafe-eval'");
    expect(directives(contentSecurityPolicy("n", { dev: false }))["script-src"]).not.toContain("'unsafe-eval'");
  });
});

describe("newNonce", () => {
  it("is different on every request", () => {
    expect(newNonce()).not.toBe(newNonce());
  });
});
