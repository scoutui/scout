/**
 * Returns null if the email's domain is in the allow-list, or if the allow-list
 * is empty / unset (which disables the gate). Otherwise returns why the sign-in
 * is denied, for the server log: an unverified, missing or malformed address,
 * or a domain outside the list.
 *
 * `allowedDomains` is a comma-separated string sourced from the
 * `OIDC_ALLOWED_DOMAINS` env var. Comparison is case-insensitive on both sides.
 *
 * `emailVerified` is the IdP's `email_verified` claim. When the gate is active
 * the address must be verified: a provider that lets a user assert their own
 * email would let anyone claim an allowed domain. Anything other than a literal
 * `true` denies, including a missing claim, so the gate fails closed.
 */
export function emailDomainDenial(
  email: string | null | undefined,
  allowedDomains: string | null | undefined,
  emailVerified: unknown,
): string | null {
  const normalized = (allowedDomains ?? "").trim();
  if (normalized === "") return null;

  if (emailVerified !== true) {
    return "the identity provider didn't mark the email address as verified, which OIDC_ALLOWED_DOMAINS requires";
  }
  const at = email ? email.indexOf("@") : -1;
  if (!email || at < 0 || at === email.length - 1) {
    return "the identity provider sent no usable email address, which OIDC_ALLOWED_DOMAINS requires";
  }
  const domain = email.slice(at + 1).toLowerCase();

  const allowed = normalized
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(domain) ? null : `the email domain ${domain} isn't in OIDC_ALLOWED_DOMAINS`;
}
