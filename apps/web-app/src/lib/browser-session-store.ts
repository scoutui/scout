/**
 * Deletion of a person's sessions from outside the browser: their browser
 * sessions and their CLI sessions.
 */

import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

const { accounts, cliSessions, sessions } = schema;

/**
 * Ends every browser session and CLI session belonging to the OIDC subject
 * `sub`, and reports how many browser sessions went. Zero is not a failure:
 * the person may have no live session, or may never have signed into this app.
 *
 * The subject is matched against `accounts.providerAccountId` for provider
 * `oidc`, the only identifier a logout token carries. Every session for that
 * user ends, since no `sid` is recorded on a session row to narrow it to one.
 */
export async function deleteSessionsForOidcSubject(sub: string): Promise<number> {
  return getDb().transaction(async (tx) => {
    const owners = tx
      .select({ userId: accounts.userId })
      .from(accounts)
      .where(and(eq(accounts.provider, "oidc"), eq(accounts.providerAccountId, sub)));

    await tx.delete(cliSessions).where(inArray(cliSessions.userId, owners));
    const deleted = await tx
      .delete(sessions)
      .where(inArray(sessions.userId, owners))
      .returning({ sessionToken: sessions.sessionToken });

    return deleted.length;
  });
}
