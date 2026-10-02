import { describe, it, expect, vi } from "vitest";
import { idpGroupDenial } from "@/lib/oidc-group-gate";

const token = "idp-access-token";

describe("idpGroupDenial", () => {
  it("returns no denial without calling the IdP when no group is required", async () => {
    const fetchGroups = vi.fn();
    await expect(idpGroupDenial(token, undefined, fetchGroups)).resolves.toBeNull();
    await expect(idpGroupDenial(token, "  ", fetchGroups)).resolves.toBeNull();
    await expect(idpGroupDenial(undefined, undefined, fetchGroups)).resolves.toBeNull();
    expect(fetchGroups).not.toHaveBeenCalled();
  });

  it("returns no denial when the required group is present", async () => {
    const fetchGroups = vi.fn(async () => ["scout-users", "other"]);
    await expect(idpGroupDenial(token, "scout-users", fetchGroups)).resolves.toBeNull();
    expect(fetchGroups).toHaveBeenCalledWith(token);
  });

  it("denies when the required group is confirmed absent", async () => {
    const fetchGroups = vi.fn(async () => ["other"]);
    await expect(idpGroupDenial(token, "scout-users", fetchGroups)).resolves.toEqual({
      reason: "the account isn't in SCOUTUI_REQUIRED_GROUP (scout-users)",
      idpUnavailable: false,
    });
  });

  it("denies a new sign-in when userinfo is unavailable", async () => {
    const fetchGroups = vi.fn(async () => {
      throw new Error("userinfo 503");
    });
    await expect(idpGroupDenial(token, "scout-users", fetchGroups)).resolves.toEqual({
      reason: expect.stringContaining("couldn't read groups from the identity provider (userinfo 503)"),
      idpUnavailable: true,
    });
  });

  it("denies a new sign-in when no access token is available to check with", async () => {
    const fetchGroups = vi.fn();
    await expect(idpGroupDenial(undefined, "scout-users", fetchGroups)).resolves.toEqual({
      reason: expect.stringContaining("no access token"),
      idpUnavailable: false,
    });
    expect(fetchGroups).not.toHaveBeenCalled();
  });
});
