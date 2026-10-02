import { randomBytes } from "node:crypto";
import { and, eq, gt, lte, or } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb, schema } from "@/db/client";
import { withCredentialStoreError } from "@/lib/cli-credential-store-errors";
import { hashToken } from "@/lib/cli-session-tokens";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function pick(n: number): string {
  const b = randomBytes(n);
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[(b[i] as number) % ALPHABET.length];
  return s;
}

export function makeUserCode(): string {
  return `${pick(4)}-${pick(4)}`;
}

const { cliDeviceCodes } = schema;

export async function createDeviceCode(): Promise<{ deviceCode: string; userCode: string }> {
  const deviceCode = randomBytes(32).toString("base64url");
  const deviceCodeHash = hashToken(deviceCode);
  const expiresAt = new Date(Date.now() + 600_000);

  return withCredentialStoreError(async () => {
    // Retry on user_code collision (extremely unlikely but possible)
    for (let attempt = 0; attempt < 5; attempt++) {
      const userCode = makeUserCode();
      try {
        await getDb()
          .insert(cliDeviceCodes)
          .values({ id: ulid(), deviceCodeHash, userCode, status: "pending", expiresAt });
        return { deviceCode, userCode };
      } catch (err) {
        // Unique constraint on userCode: retry with a new one
        if (attempt < 4 && err instanceof Error && err.message.includes("unique")) continue;
        throw err;
      }
    }
    throw new Error("Failed to generate unique user code after 5 attempts");
  });
}

export async function findByDeviceCodeHash(
  hash: string,
): Promise<typeof cliDeviceCodes.$inferSelect | null> {
  return withCredentialStoreError(async () => {
    const row = await getDb().query.cliDeviceCodes.findFirst({
      where: eq(cliDeviceCodes.deviceCodeHash, hash),
    });
    return row ?? null;
  });
}

export async function findByUserCode(
  code: string,
): Promise<typeof cliDeviceCodes.$inferSelect | null> {
  return withCredentialStoreError(async () => {
    const row = await getDb().query.cliDeviceCodes.findFirst({
      where: eq(cliDeviceCodes.userCode, code),
    });
    return row ?? null;
  });
}

export async function pruneDeviceCodes(now = new Date()): Promise<void> {
  await withCredentialStoreError(() => getDb()
    .delete(cliDeviceCodes)
    .where(or(lte(cliDeviceCodes.expiresAt, now), eq(cliDeviceCodes.status, "consumed"))));
}

export async function deleteDeniedDeviceCode(id: string): Promise<void> {
  await withCredentialStoreError(() => getDb()
    .delete(cliDeviceCodes)
    .where(and(eq(cliDeviceCodes.id, id), eq(cliDeviceCodes.status, "denied"))));
}

/** Transition an unexpired pending code to approved. */
export async function markApproved(userCode: string, userId: string): Promise<boolean> {
  return withCredentialStoreError(async () => {
    const rows = await getDb()
      .update(cliDeviceCodes)
      .set({ status: "approved", approvedUserId: userId })
      .where(
        and(
          eq(cliDeviceCodes.userCode, userCode),
          eq(cliDeviceCodes.status, "pending"),
          gt(cliDeviceCodes.expiresAt, new Date()),
        ),
      )
      .returning({ id: cliDeviceCodes.id });
    return rows.length > 0;
  });
}

export async function markDenied(userCode: string): Promise<boolean> {
  return withCredentialStoreError(async () => {
    const rows = await getDb()
      .update(cliDeviceCodes)
      .set({ status: "denied" })
      .where(
        and(
          eq(cliDeviceCodes.userCode, userCode),
          eq(cliDeviceCodes.status, "pending"),
          gt(cliDeviceCodes.expiresAt, new Date()),
        ),
      )
      .returning({ id: cliDeviceCodes.id });
    return rows.length > 0;
  });
}

export async function touchPoll(id: string): Promise<void> {
  await withCredentialStoreError(() => getDb()
    .update(cliDeviceCodes)
    .set({ lastPolledAt: new Date() })
    .where(eq(cliDeviceCodes.id, id)));
}
