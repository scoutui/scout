import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { fetchUserGroups, IdpRefreshError } from "@/lib/idp-refresh";

beforeEach(() => {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  process.env["OIDC_ISSUER_URL"] = "https://idp.test/issuer";
});
afterEach(() => vi.restoreAllMocks());

describe("fetchUserGroups", () => {
  it("returns the groups array on success", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes(".well-known")) {
        return new Response(JSON.stringify({ userinfo_endpoint: "https://idp.test/userinfo" }), { status: 200 });
      }
      return new Response(JSON.stringify({ sub: "u1", groups: ["scout-users", "other"] }), { status: 200 });
    });
    await expect(fetchUserGroups("access-token")).resolves.toEqual(["scout-users", "other"]);
  });
  it("throws IdpRefreshError when userinfo returns non-200", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes(".well-known")) {
        return new Response(JSON.stringify({ userinfo_endpoint: "https://idp.test/userinfo" }), { status: 200 });
      }
      return new Response("Unauthorized", { status: 401 });
    });
    await expect(fetchUserGroups("bad-token")).rejects.toBeInstanceOf(IdpRefreshError);
    await expect(fetchUserGroups("bad-token")).rejects.toMatchObject({ reason: "network" });
  });
});
