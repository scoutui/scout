import { asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb, schema } from "@/db/client";
import { adminSettings, type Person, personIdentity, ROLES, type Role, type RoleSource } from "@/lib/access";
import { fetchUserGroups } from "@/lib/idp-refresh";

const { cliDeviceCodes, cliSessions, roleChanges, sessions, users } = schema;

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

const PERSON_COLUMNS = {
  id: users.id,
  email: users.email,
  name: users.name,
  emailVerified: users.emailVerified,
  role: users.role,
  adminGroup: users.adminGroup,
};

export type PersonListing = { userId: string; name: string | null; email: string; lastSignedInAt: string | null; role: Role; roleSource: RoleSource };

/** Everyone who hasn't been removed, by email, with their role as it stands now. */
export async function listPeople(): Promise<PersonListing[]> {
  const settings = adminSettings();
  const rows = await getDb()
    .select({ ...PERSON_COLUMNS, lastSignedInAt: users.lastSignedInAt })
    .from(users)
    .where(isNotNull(users.role))
    .orderBy(asc(users.email));
  return rows.flatMap((row) => {
    const person = personIdentity(row, settings);
    if (person === null) return [];
    return [{
      userId: person.userId,
      name: person.name,
      email: person.email,
      lastSignedInAt: row.lastSignedInAt?.toISOString() ?? null,
      role: person.role,
      roleSource: person.roleSource,
    }];
  });
}

/** A role set on the People page. `toRole` is null when the person was removed. */
export type RoleChange = { id: string; changedAt: string; actorEmail: string; subjectEmail: string; fromRole: Role; toRole: Role | null };

/** The latest `limit` role changes, newest first. */
export async function listRoleChanges(limit: number): Promise<RoleChange[]> {
  const rows = await getDb()
    .select()
    .from(roleChanges)
    .orderBy(desc(roleChanges.changedAt), desc(roleChanges.id))
    .limit(limit);
  return rows.map((row) => ({ ...row, changedAt: row.changedAt.toISOString() }));
}

export type PeopleResult = { ok: true } | { ok: false; error: string };

const CHANGED_SINCE_LOADED: PeopleResult = { ok: false, error: "This person's role has changed since the page loaded. Reload to see it." };

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Locks the person `userId` and runs `change` in the same transaction, when `actor` may change them: someone other
 * than `actor`, not removed, whose role comes from one of `sources`.
 */
async function changePerson(
  actor: Person,
  userId: string,
  sources: readonly RoleSource[],
  change: (tx: Transaction, target: Person) => Promise<void>,
): Promise<PeopleResult> {
  return getDb().transaction(async (tx): Promise<PeopleResult> => {
    const [row] = await tx.select(PERSON_COLUMNS).from(users).where(eq(users.id, userId)).for("update");
    const target = row ? personIdentity(row, adminSettings()) : null;
    if (target === null || target.userId === actor.userId || !sources.includes(target.roleSource)) return CHANGED_SINCE_LOADED;
    await change(tx, target);
    return { ok: true };
  });
}

/** Gives the person `userId` the role `role`, and records the change in the history. */
export async function setRole(actor: Person, userId: string, role: Role): Promise<PeopleResult> {
  if (!ROLES.includes(role)) return CHANGED_SINCE_LOADED;
  return changePerson(actor, userId, ["people"], async (tx, target) => {
    if (target.role === role) return;
    await tx.update(users).set({ role }).where(eq(users.id, userId));
    await tx.insert(roleChanges).values({ id: ulid(), actorEmail: actor.email, subjectEmail: target.email, fromRole: target.role, toRole: role });
  });
}

/**
 * Removes the person `userId`, whose role is set on the People page or comes from the admin group: ends their browser
 * and CLI sessions, drops the CLI sign-ins they approved but haven't used, clears their role and admin group, and
 * records the removal in the history. Their row stays: signing in again brings them back to it as a Viewer, or as an
 * Admin while they're in the admin group.
 */
export async function removePerson(actor: Person, userId: string): Promise<PeopleResult> {
  return changePerson(actor, userId, ["people", "group"], async (tx, target) => {
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(cliSessions).where(eq(cliSessions.userId, userId));
    await tx.delete(cliDeviceCodes).where(eq(cliDeviceCodes.approvedUserId, userId));
    await tx.update(users).set({ role: null, adminGroup: null }).where(eq(users.id, userId));
    await tx.insert(roleChanges).values({ id: ulid(), actorEmail: actor.email, subjectEmail: target.email, fromRole: target.role, toRole: null });
  });
}
