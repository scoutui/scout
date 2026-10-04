import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { auth } from "@/auth";
import { getDb, schema } from "@/db/client";
import { adminSettings, can, EDIT_REFUSAL, type Identity, type Person, personIdentity } from "@/lib/access";
import { resolveCliSession } from "@/lib/cli-session-store";

/** A request's credentials: the browser's session cookie, or an `Authorization` header. */
export type Caller = { browser: true } | { bearer: string | null };

function ciTokenMatches(token: string): boolean {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const expected = process.env["SCOUTUI_CI_UPLOAD_TOKEN"];
  if (!expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function loadPerson(userId: string): Promise<Person | null> {
  const row = await getDb().query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { id: true, email: true, name: true, emailVerified: true, role: true, adminGroup: true },
  });
  return row ? personIdentity(row, adminSettings()) : null;
}

const browserIdentity = cache(async (): Promise<Person | null> => {
  const userId = (await auth())?.user?.id;
  return userId ? loadPerson(userId) : null;
});

/** Who `caller` is, with their role read now, or null when they aren't signed in. */
export async function identify(caller: Caller): Promise<Identity | null> {
  if ("browser" in caller) return browserIdentity();
  if (!caller.bearer?.startsWith("Bearer ")) return null;
  const token = caller.bearer.slice("Bearer ".length);
  if (ciTokenMatches(token)) return { kind: "ci" };
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
