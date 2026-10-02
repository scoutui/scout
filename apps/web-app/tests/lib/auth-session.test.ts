import { describe, it, expect } from "vitest";
import {
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  isSessionExpired,
  nextSessionToken,
  sessionStrategy,
  stampAbsoluteExpiry,
} from "@/lib/auth-session";

const HOUR = 60 * 60;
const SIGN_IN = Date.UTC(2026, 7, 29, 9, 0, 0);

describe("session timing values", () => {
  it("ends a browser session 12 hours after sign-in", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(12 * HOUR);
  });

  // Auth.js only extends a session's expiry once `updateAge` has elapsed since
  // the session began, so an update interval above the maximum age means the
  // expiry set at sign-in never moves.
  it("never lets the session extension fire: update interval exceeds max age", () => {
    expect(SESSION_UPDATE_AGE_SECONDS).toBeGreaterThan(SESSION_MAX_AGE_SECONDS);
  });
});

describe("stampAbsoluteExpiry", () => {
  it("keeps the rest of the token intact", () => {
    const stamped = stampAbsoluteExpiry({ sub: "user-1", email: "you@example.com" }, SIGN_IN);
    expect(stamped.sub).toBe("user-1");
    expect(stamped.email).toBe("you@example.com");
  });

  it("does not mutate the token it is given", () => {
    const token = { sub: "user-1" };
    stampAbsoluteExpiry(token, SIGN_IN);
    expect(token).toEqual({ sub: "user-1" });
  });

  it("re-stamping moves the deadline, which is why only sign-in may do it", () => {
    const first = stampAbsoluteExpiry({}, SIGN_IN);
    const second = stampAbsoluteExpiry(first, SIGN_IN + HOUR * 1000);
    expect(isSessionExpired(first, SIGN_IN + 12 * HOUR * 1000)).toBe(true);
    expect(isSessionExpired(second, SIGN_IN + 12 * HOUR * 1000)).toBe(false);
  });
});

describe("isSessionExpired", () => {
  const token = stampAbsoluteExpiry({ sub: "user-1" }, SIGN_IN);
  const deadline = SIGN_IN + SESSION_MAX_AGE_SECONDS * 1000;

  it("is live a second before the deadline", () => {
    expect(isSessionExpired(token, deadline - 1000)).toBe(false);
  });

  it("is expired exactly on the deadline", () => {
    expect(isSessionExpired(token, deadline)).toBe(true);
  });

  it("is expired a second after the deadline", () => {
    expect(isSessionExpired(token, deadline + 1000)).toBe(true);
  });

  it("is live at sign-in", () => {
    expect(isSessionExpired(token, SIGN_IN)).toBe(false);
  });

  it("ignores activity: reading the session does not move the deadline", () => {
    for (let elapsed = 0; elapsed < 12 * HOUR; elapsed += HOUR) {
      expect(isSessionExpired(token, SIGN_IN + elapsed * 1000)).toBe(false);
    }
    expect(isSessionExpired(token, deadline)).toBe(true);
  });

  // Fail closed: a token with no deadline would otherwise escape the ceiling.
  it("treats an unstamped token as expired", () => {
    expect(isSessionExpired({ sub: "user-1" }, SIGN_IN)).toBe(true);
  });
});

type Token = Record<string, unknown>;

describe("nextSessionToken", () => {
  // biome-ignore lint/complexity/useLiteralKeys: index-signature access
  const deadlineOf = (token: Token | null) => token?.["absoluteExpiry"];

  it("stamps a deadline at sign-in and at sign-up", () => {
    const expected = deadlineOf(stampAbsoluteExpiry({}, SIGN_IN));
    expect(deadlineOf(nextSessionToken({ sub: "u" }, "signIn", SIGN_IN))).toBe(expected);
    expect(deadlineOf(nextSessionToken({ sub: "u" }, "signUp", SIGN_IN))).toBe(expected);
  });

  // The rule that makes the ceiling absolute. Re-stamping here is what a
  // sliding window is, so a read must return the token untouched.
  it("never re-stamps on a read, however many reads there are", () => {
    let token: Token | null = nextSessionToken<Token>({ sub: "u" }, "signIn", SIGN_IN);
    for (let elapsed = HOUR; elapsed < 12 * HOUR; elapsed += HOUR) {
      token = nextSessionToken(token as Token, undefined, SIGN_IN + elapsed * 1000);
      expect(deadlineOf(token)).toBe(SIGN_IN / 1000 + SESSION_MAX_AGE_SECONDS);
    }
  });

  it("never re-stamps on a client-triggered session update either", () => {
    const signedIn = nextSessionToken<Token>({ sub: "u" }, "signIn", SIGN_IN);
    const updated = nextSessionToken(signedIn as Token, "update", SIGN_IN + 6 * HOUR * 1000);
    expect(deadlineOf(updated)).toBe(SIGN_IN / 1000 + SESSION_MAX_AGE_SECONDS);
  });

  // null is what makes Auth.js clear the cookie.
  it("ends the session on the deadline", () => {
    const signedIn = nextSessionToken<Token>({ sub: "u" }, "signIn", SIGN_IN) as Token;
    const deadline = SIGN_IN + SESSION_MAX_AGE_SECONDS * 1000;
    expect(nextSessionToken(signedIn, undefined, deadline - 1000)).not.toBeNull();
    expect(nextSessionToken(signedIn, undefined, deadline)).toBeNull();
  });

  it("ends a session that carries no deadline at all", () => {
    expect(nextSessionToken({ sub: "u" }, undefined, SIGN_IN)).toBeNull();
  });
});

describe("sessionStrategy", () => {
  const OIDC = { OIDC_ISSUER_URL: "https://auth.example.com/" };

  // The dev bypass is a Credentials provider, and Auth.js requires the cookie
  // strategy for those. Everywhere else gets rows, which is what makes a
  // session revocable at all.
  it("uses cookie sessions only where the dev bypass is active", () => {
    expect(sessionStrategy({ NODE_ENV: "development", DEV_AUTH_PASSWORD: "x" })).toBe("jwt");
    expect(sessionStrategy({ NODE_ENV: "development", DEV_AUTH_PASSWORD: "x", ...OIDC })).toBe("jwt");
  });

  it("uses database sessions in production", () => {
    expect(sessionStrategy({ NODE_ENV: "production", ...OIDC })).toBe("database");
  });

  // A DEV_AUTH_PASSWORD that leaks into production must not downgrade it to
  // cookie sessions, which cannot be revoked.
  it("keeps database sessions in production even if a dev password is set", () => {
    expect(sessionStrategy({ NODE_ENV: "production", DEV_AUTH_PASSWORD: "x", ...OIDC })).toBe(
      "database",
    );
  });

  it("uses database sessions in development when the bypass is off", () => {
    expect(sessionStrategy({ NODE_ENV: "development", ...OIDC })).toBe("database");
  });
});
