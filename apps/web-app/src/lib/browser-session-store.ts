/**
 * Deletion of browser sessions, the one place a session is ended from outside
 * the browser. Browser sessions only: `cli_sessions` has its own revocation
 * path.
 */

import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

const { accounts, sessions } = schema;

/**
 * Ends every browser session belonging to the OIDC subject `sub`, and reports
 * how many rows went. Zero is not a failure: the person may have no live
 * session, or may never have signed into this app.
 *
 * The subject is matched against `accounts.providerAccountId` for provider
 * `oidc`, the only identifier a logout token carries. Every session for that
 * user ends, since no `sid` is recorded on a session row to narrow it to one.
 */
export async function deleteSessionsForOidcSubject(sub: string): Promise<number> {
  const db = getDb();
  const owners = db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.provider, "oidc"), eq(accounts.providerAccountId, sub)));

  const deleted = await db
    .delete(sessions)
    .where(inArray(sessions.userId, owners))
    .returning({ sessionToken: sessions.sessionToken });

  return deleted.length;
}
