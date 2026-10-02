import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "@/lib/callback-url";

describe("safeCallbackUrl", () => {
  it("passes through internal paths, including query strings", () => {
    expect(safeCallbackUrl("/packages?deprecated=true")).toBe("/packages?deprecated=true");
    expect(safeCallbackUrl("/login/device?code=ABCD-EFGH")).toBe("/login/device?code=ABCD-EFGH");
  });

  it("falls back to /repos when absent or empty", () => {
    expect(safeCallbackUrl(undefined)).toBe("/repos");
    expect(safeCallbackUrl("")).toBe("/repos");
  });

  it("rejects absolute and protocol-relative URLs (open-redirect guard)", () => {
    expect(safeCallbackUrl("https://evil.example/phish")).toBe("/repos");
    expect(safeCallbackUrl("//evil.example/phish")).toBe("/repos");
  });

  it("rejects URL-normalization bypasses (backslash, tab)", () => {
    expect(safeCallbackUrl("/\\evil.example")).toBe("/repos");
    expect(safeCallbackUrl("/\t/evil.example")).toBe("/repos");
  });
});
