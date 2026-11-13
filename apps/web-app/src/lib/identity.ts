import { eq } from "drizzle-orm";
import { cache } from "react";
import { auth } from "@/auth";
import { getDb, getPool, schema } from "@/db/client";
import { adminSettings, can, EDIT_REFUSAL, guestViewEnabled, type Identity, type Person, personIdentity } from "@/lib/access";
import { withCredentialStoreError } from "@/lib/cli-credential-store-errors";
import { resolveCliSession } from "@/lib/cli-session-store";
import { isRepoUploadToken, uploadTokenRepo } from "@/lib/repo-upload-tokens";

/** A request's credentials: the browser's session cookie, or an `Authorization` header. */
export type Caller = { browser: true } | { bearer: string | null };

async function loadPerson(userId: string): Promise<Person | null> {
  const row = await getDb().query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { id: true, email: true, name: true, emailVerified: true, role: true, adminGroup: true },
  });
  return row ? personIdentity(row, adminSettings()) : null;
}

const browserIdentity = cache(async (): Promise<Identity | null> => {
  const userId = (await auth())?.user?.id;
  if (userId) return loadPerson(userId);
  return guestViewEnabled() ? { kind: "guest" } : null;
});

/** Who `caller` is, with their role read now: a guest for a browser without a session when guest view is on, or null when they aren't signed in. */
export async function identify(caller: Caller): Promise<Identity | null> {
  if ("browser" in caller) return browserIdentity();
  if (!caller.bearer?.startsWith("Bearer ")) return null;
  const token = caller.bearer.slice("Bearer ".length);
  if (isRepoUploadToken(token)) {
    const repoId = await withCredentialStoreError(() => uploadTokenRepo(getPool(), token));
    return repoId === null ? null : { kind: "repo-token", repoId };
  }
  const session = await resolveCliSession(token);
  return session ? loadPerson(session.userId) : null;
}

/** The signed-in browser person's id when they may edit, or the error a server action returns. */
export async function requireEditor(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const identity = await identify({ browser: true });
  if (identity?.kind !== "person") return { ok: false, error: "not_authenticated" };
  if (!can(identity, "edit")) return { ok: false, error: EDIT_REFUSAL };
  return { ok: true, userId: identity.userId };
}
