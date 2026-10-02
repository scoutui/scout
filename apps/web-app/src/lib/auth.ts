import { timingSafeEqual } from "node:crypto";
import { resolveCliSession } from "@/lib/cli-session-store";

export type BearerIdentity = { sessionId: string; userId: string; email: string };

/** Validates a CLI user session bearer and returns its joined user identity. */
export async function verifyBearer(header: string | null): Promise<BearerIdentity | null> {
  if (!header || !header.startsWith("Bearer ")) return null;
  return resolveCliSession(header.slice("Bearer ".length));
}

export type UploadIdentity = { kind: "user"; userId: string } | { kind: "ci" };

function ciTokenMatches(token: string): boolean {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const expected = process.env["SCOUTUI_CI_UPLOAD_TOKEN"];
  if (!expected) return false; // CI path disabled unless configured
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Validates a `Bearer` for the scan upload endpoint. Accepts either the shared
 * CI secret (`SCOUTUI_CI_UPLOAD_TOKEN`, timing-safe) → `{ kind: "ci" }`, or a
 * CLI user session → `{ kind: "user", userId }`. Returns null otherwise.
 */
export async function verifyUploadBearer(header: string | null): Promise<UploadIdentity | null> {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  if (ciTokenMatches(token)) return { kind: "ci" };
  const session = await resolveCliSession(token);
  return session ? { kind: "user", userId: session.userId } : null;
}
