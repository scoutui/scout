import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { adminSettings } from "@/lib/access";
import { fetchUserGroups } from "@/lib/idp-refresh";

/**
 * Records a browser sign-in on the person's row: whether the provider marked the email verified, when they signed in,
 * which admin group they're in, and a Viewer role when they had been removed.
 */
export async function recordSignIn(input: {
  userId: string;
  email: string;
  provider: string | undefined;
  emailVerified: boolean;
  accessToken: string | undefined;
}, fetchGroups: (accessToken: string) => Promise<string[]> = fetchUserGroups): Promise<void> {
  const settings = adminSettings();
  if (settings.emails.has(input.email.toLowerCase()) && !input.emailVerified) {
    console.warn(`[auth] ${input.email} is in SCOUTUI_ADMINS, but the sign-in provider didn't mark the email verified, so they aren't an Admin.`);
  }
  let adminGroup: string | null = null;
  if (settings.group !== null && input.provider !== "dev") {
    try {
      if (!input.accessToken) throw new Error("the sign-in provider sent no access token");
      if ((await fetchGroups(input.accessToken)).includes(settings.group)) adminGroup = settings.group;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[auth] Couldn't check whether ${input.email} is in SCOUTUI_ADMIN_GROUP, so they aren't an Admin until they sign in again: ${reason}`);
    }
  }
  await getDb().update(schema.users).set({
    emailVerified: input.emailVerified ? new Date() : null,
    lastSignedInAt: sql`now()`,
    adminGroup,
    role: sql`COALESCE(${schema.users.role}, 'viewer')`,
  }).where(eq(schema.users.id, input.userId));
}
