"use server";
import { revalidatePath } from "next/cache";
import { type TagInput, TagInputSchema } from "@scoutui/web-shared";
import { requireEditor } from "@/lib/identity";
import { getStorage } from "@/lib/storage";

export async function saveTag(input: TagInput): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireEditor();
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
  const gate = await requireEditor();
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
  const gate = await requireEditor();
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
