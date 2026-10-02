import { createHash, randomBytes } from "node:crypto";

const USER_SESSION_TOKEN_PATTERN = /^scout_u_[A-Za-z0-9_-]{43}$/;

export function generateUserSessionToken(): string {
  return `scout_u_${randomBytes(32).toString("base64url")}`;
}

export function isUserSessionToken(token: string): boolean {
  return USER_SESSION_TOKEN_PATTERN.test(token);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
