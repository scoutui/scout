import { describe, expect, it } from "vitest";
import { generateUserSessionToken, hashToken, isUserSessionToken } from "@/lib/cli-session-tokens";

describe("CLI user session tokens", () => {
  it("generates a 32-byte base64url token with the user-session prefix", () => {
    const token = generateUserSessionToken();
    expect(token).toMatch(/^scout_u_[A-Za-z0-9_-]{43}$/);
    expect(isUserSessionToken(token)).toBe(true);
  });

  it("generates distinct tokens", () => {
    expect(generateUserSessionToken()).not.toBe(generateUserSessionToken());
  });

  it("rejects other prefixes, lengths, and non-base64url characters", () => {
    expect(isUserSessionToken(`cc_r_${"a".repeat(43)}`)).toBe(false);
    expect(isUserSessionToken(`scout_u_${"a".repeat(42)}`)).toBe(false);
    expect(isUserSessionToken(`scout_u_${"a".repeat(44)}`)).toBe(false);
    expect(isUserSessionToken(`scout_u_${"a".repeat(42)}=`)).toBe(false);
  });

  it("hashes a token to a deterministic lowercase SHA-256 digest", () => {
    expect(hashToken("scout_u_value")).toBe("6fa1ea54d4e4be272279a9be621755d75caa37ac6a7a812fd02fdf2193b9c907");
    expect(hashToken("scout_u_value")).toMatch(/^[0-9a-f]{64}$/);
  });
});
