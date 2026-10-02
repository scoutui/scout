import { and, eq, gt, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb, schema } from "@/db/client";
import { withCredentialStoreError } from "@/lib/cli-credential-store-errors";
import { generateUserSessionToken, hashToken, isUserSessionToken } from "@/lib/cli-session-tokens";

const { cliDeviceCodes, cliSessions, users } = schema;

export async function resolveCliSession(
  token: string,
): Promise<{ sessionId: string; userId: string; email: string } | null> {
  if (!isUserSessionToken(token)) return null;

  return withCredentialStoreError(async () => {
    const [session] = await getDb()
      .select({ sessionId: cliSessions.id, userId: cliSessions.userId, email: users.email })
      .from(cliSessions)
      .innerJoin(users, eq(cliSessions.userId, users.id))
      .where(eq(cliSessions.tokenHash, hashToken(token)))
      .limit(1);

    return session ?? null;
  });
}

export async function consumeApprovedDeviceCode(
  deviceCodeId: string,
  approvedUserId: string,
): Promise<{ token: string; email: string } | null> {
  return withCredentialStoreError(() => getDb().transaction(async (tx) => {
    // Lock first: PostgreSQL can evaluate an UPDATE predicate before waiting on its row lock.
    await tx.execute(sql`SELECT id FROM ${cliDeviceCodes} WHERE ${cliDeviceCodes.id} = ${deviceCodeId} FOR UPDATE`);
    const [consumed] = await tx
      .update(cliDeviceCodes)
      .set({ status: "consumed" })
      .where(and(
        eq(cliDeviceCodes.id, deviceCodeId),
        eq(cliDeviceCodes.status, "approved"),
        eq(cliDeviceCodes.approvedUserId, approvedUserId),
        gt(cliDeviceCodes.expiresAt, sql`clock_timestamp()`),
      ))
      .returning({ id: cliDeviceCodes.id });

    if (!consumed) return null;

    const token = generateUserSessionToken();
    await tx.insert(cliSessions).values({ id: ulid(), userId: approvedUserId, tokenHash: hashToken(token) });

    const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, approvedUserId)).limit(1);
    if (!user) throw new Error("Approved CLI user not found");

    return { token, email: user.email };
  }));
}

export async function revokeCliSession(token: string): Promise<boolean> {
  if (!isUserSessionToken(token)) return false;

  return withCredentialStoreError(async () => {
    const rows = await getDb()
      .delete(cliSessions)
      .where(eq(cliSessions.tokenHash, hashToken(token)))
      .returning({ id: cliSessions.id });

    return rows.length > 0;
  });
}
