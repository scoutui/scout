"use server";
import { revalidatePath } from "next/cache";
import { can, type Role } from "@/lib/access";
import { identify } from "@/lib/identity";
import { type PeopleResult, removePerson, setRole } from "@/lib/people";

const ADMIN_REFUSAL = "Only Admins can change roles.";

export async function changeRole(userId: string, role: Role): Promise<PeopleResult> {
  const identity = await identify({ browser: true });
  if (identity?.kind !== "person") return { ok: false, error: "not_authenticated" };
  if (!can(identity, "manage-people")) return { ok: false, error: ADMIN_REFUSAL };
  const result = await setRole(identity, userId, role);
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function removeFromPeople(userId: string): Promise<PeopleResult> {
  const identity = await identify({ browser: true });
  if (identity?.kind !== "person") return { ok: false, error: "not_authenticated" };
  if (!can(identity, "manage-people")) return { ok: false, error: ADMIN_REFUSAL };
  const result = await removePerson(identity, userId);
  if (result.ok) revalidatePath("/settings");
  return result;
}
