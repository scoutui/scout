"use server";
import { revalidatePath } from "next/cache";
import { type TagInput, TagInputSchema } from "@scoutui/web-shared";
import { auth } from "@/auth";
import { getStorage } from "@/lib/storage";

async function requireUser(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "not_authenticated" };
  return { ok: true, userId: session.user.id };
}

export async function saveTag(input: TagInput): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  const parsed = TagInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't save the tag. Reload the page and try again." };
  await getStorage().upsertTag(parsed.data, gate.userId);
  revalidatePath("/packages", "layout");
  revalidatePath("/charts");
  revalidatePath("/repos", "layout");
  return { ok: true };
}

export async function deleteTag(id: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  await getStorage().deleteTag(id);
  revalidatePath("/packages", "layout");
  revalidatePath("/charts");
  revalidatePath("/repos", "layout");
  return { ok: true };
}

/** Quick-tag a package from a table row: add/remove it from a tag's `exact` list. */
export async function quickTagPackage(
  tagId: string,
  packageName: string,
  add: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  if (typeof packageName !== "string" || packageName.trim() === "") {
    return { ok: false, error: "Couldn't update the tag. Reload the page and try again." };
  }
  const tags = await getStorage().listTags();
  const tag = tags.find((t) => t.id === tagId);
  if (!tag) return { ok: false, error: "unknown_tag" };
  const exact = new Set(tag.rule.exact);
  if (add) exact.add(packageName);
  else exact.delete(packageName);
  await getStorage().upsertTag({ ...tag, rule: { ...tag.rule, exact: [...exact] } }, gate.userId);
  revalidatePath("/packages", "layout");
  revalidatePath("/charts");
  revalidatePath("/repos", "layout");
  return { ok: true };
}
