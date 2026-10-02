import { describe, it, expect } from "vitest";
import { emailDomainDenial } from "../../src/lib/oidc-domain-gate";

describe("emailDomainDenial", () => {
  it("returns no denial for any email when allowedDomains is empty (gate disabled)", () => {
    // The verification claim is irrelevant while the gate is off.
    expect(emailDomainDenial("anyone@anywhere.com", "", undefined)).toBeNull();
    expect(emailDomainDenial("anyone@anywhere.com", undefined, false)).toBeNull();
  });

  it("returns no denial for an email whose domain matches a single allowed domain", () => {
    expect(emailDomainDenial("alice@example.com", "example.com", true)).toBeNull();
  });

  it("returns no denial for an email whose domain matches one of several allowed domains", () => {
    expect(emailDomainDenial("alice@example.org", "example.com,example.org", true)).toBeNull();
  });

  it("trims whitespace around allowed domains", () => {
    expect(emailDomainDenial("alice@example.org", " example.com , example.org ", true)).toBeNull();
  });

  it("denies email whose domain does not match", () => {
    expect(emailDomainDenial("outsider@invalid.test", "example.com", true)).toBe("the email domain invalid.test isn't in OIDC_ALLOWED_DOMAINS");
  });

  it("denies missing email when gate is configured", () => {
    expect(emailDomainDenial(undefined, "example.com", true)).toMatch(/no usable email address/);
    expect(emailDomainDenial("", "example.com", true)).toMatch(/no usable email address/);
    expect(emailDomainDenial(null, "example.com", true)).toMatch(/no usable email address/);
  });

  it("denies malformed email (no @)", () => {
    expect(emailDomainDenial("notanemail", "example.com", true)).toMatch(/no usable email address/);
  });

  it("compares domain case-insensitively", () => {
    expect(emailDomainDenial("ALICE@Example.com", "example.com", true)).toBeNull();
  });

  it("denies an otherwise-allowed domain when the address is unverified", () => {
    // The domain only counts if the IdP vouched for the address; a provider
    // that lets users assert their own email would otherwise let anyone in.
    expect(emailDomainDenial("alice@example.com", "example.com", false)).toMatch(/didn't mark the email address as verified/);
  });

  it("fails closed when the IdP omits email_verified", () => {
    // Absent is not verified. This only affects deployments that opted into
    // domain restriction.
    expect(emailDomainDenial("alice@example.com", "example.com", undefined)).toMatch(/didn't mark the email address as verified/);
    expect(emailDomainDenial("alice@example.com", "example.com", null)).toMatch(/didn't mark the email address as verified/);
  });

  it("requires a literal true, not a truthy value", () => {
    // Some providers send the claim as a string. "false" is truthy, so a
    // truthiness check here would admit exactly the case it should reject.
    expect(emailDomainDenial("alice@example.com", "example.com", "true")).toMatch(/didn't mark the email address as verified/);
    expect(emailDomainDenial("alice@example.com", "example.com", "false")).toMatch(/didn't mark the email address as verified/);
    expect(emailDomainDenial("alice@example.com", "example.com", 1)).toMatch(/didn't mark the email address as verified/);
  });
});
