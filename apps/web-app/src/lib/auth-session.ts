/**
 * Browser-session policy: where a session is recorded, how long it lasts, and
 * when it is over. "Browser session" is the web app's own sign-in record, not
 * the CLI session or the IdP session.
 */

import { isDevAuthEnabled } from "@/lib/auth-providers";

/**
 * Where a browser session is recorded.
 *
 * `"database"` stores a row, so a session can be revoked by deleting it (as
 * back-channel logout does).
 *
 * `"jwt"` keeps the session in a cookie and is used only when the local dev
 * sign-in is active, because Auth.js requires the cookie strategy for a
 * Credentials provider. Dev therefore skips the production session path;
 * `tests/api/session-revocation.test.ts` covers it.
 *
 * It gates on `isDevAuthEnabled`, not on the password alone, so a
 * `DEV_AUTH_PASSWORD` leaked into production can't switch it to cookie sessions
 * and lose revocation.
 */
export function sessionStrategy(
  env: Record<string, string | undefined> = process.env,
): "jwt" | "database" {
  return isDevAuthEnabled(env) ? "jwt" : "database";
}

/** A browser session ends this long after sign-in, whatever the person is doing. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * Longer than `SESSION_MAX_AGE_SECONDS` on purpose: this is what makes the
 * maximum age absolute.
 *
 * Auth.js extends a session's expiry only once the update interval has passed
 * (`@auth/core/lib/actions/session.js` writes a new expiry when
 * `expires - maxAge + updateAge <= now`). With the interval above the maximum
 * age, the session expires before that point, so the expiry set at sign-in is
 * the only one. Raising `SESSION_MAX_AGE_SECONDS` past this value brings back a
 * sliding idle window.
 *
 * This holds the ceiling under the database strategy. The cookie strategy
 * re-signs on every read and takes its ceiling from `nextSessionToken` instead.
 */
export const SESSION_UPDATE_AGE_SECONDS = 48 * 60 * 60;

/**
 * The claim carrying the session's deadline, in epoch seconds like `iat` and
 * `exp`. It can't be `exp`: Auth.js re-signs the token on every session read
 * and `setExpirationTime` overwrites `exp` each time.
 */
const ABSOLUTE_EXPIRY_CLAIM = "absoluteExpiry";

function toEpochSeconds(nowMs: number): number {
  return Math.floor(nowMs / 1000);
}

/** Stamps a freshly signed-in token with the moment its session must end. */
export function stampAbsoluteExpiry<T extends Record<string, unknown>>(
  token: T,
  nowMs: number,
): T & { [ABSOLUTE_EXPIRY_CLAIM]: number } {
  return { ...token, [ABSOLUTE_EXPIRY_CLAIM]: toEpochSeconds(nowMs) + SESSION_MAX_AGE_SECONDS };
}

/**
 * Whether a session has reached its ceiling: expired on the deadline, not
 * after it. A token with no deadline is expired.
 */
export function isSessionExpired(token: Record<string, unknown>, nowMs: number): boolean {
  const deadline = token[ABSOLUTE_EXPIRY_CLAIM];
  if (typeof deadline !== "number") return true;
  return toEpochSeconds(nowMs) >= deadline;
}

/**
 * The token Auth.js should carry forward for a session, or `null` to end it.
 * Only sign-in sets the deadline; every later read measures against it.
 *
 * `trigger` is what Auth.js passes: `"signIn"` or `"signUp"` on the callback and
 * sign-up paths, `"update"` when a client calls `update()`, and nothing on an
 * ordinary session read.
 */
export function nextSessionToken<T extends Record<string, unknown>>(
  token: T,
  trigger: "signIn" | "signUp" | "update" | undefined,
  nowMs: number,
): T | null {
  if (trigger === "signIn" || trigger === "signUp") return stampAbsoluteExpiry(token, nowMs);
  return isSessionExpired(token, nowMs) ? null : token;
}
