"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/db/client";
import { can, REPO_ADMIN_REFUSAL } from "@/lib/access";
import { identify } from "@/lib/identity";
import { errorClass } from "@/lib/scan-jobs";
import { deleteStoredRepo, type RemovalResult, removeStoredScan } from "@/lib/scan-removal";

export async function removeScan(repoId: string, scanId: string): Promise<RemovalResult> {
  const identity = await identify({ browser: true });
  if (identity?.kind !== "person") return { ok: false, error: "not_authenticated" };
  if (!can(identity, "manage-repos", { repoId })) return { ok: false, error: REPO_ADMIN_REFUSAL };
  let result: RemovalResult;
  try {
    result = await removeStoredScan(getPool(), identity, repoId, scanId);
  } catch (err) {
    console.error(`[repos] removing a scan failed: ${errorClass(err)}`);
    return { ok: false, error: "Couldn't remove the scan. Try again." };
  }
  if (result.ok) revalidatePath("/repos", "layout");
  return result;
}

export async function deleteRepo(repoId: string): Promise<RemovalResult> {
  const identity = await identify({ browser: true });
  if (identity?.kind !== "person") return { ok: false, error: "not_authenticated" };
  if (!can(identity, "manage-repos", { repoId })) return { ok: false, error: REPO_ADMIN_REFUSAL };
  try {
    await deleteStoredRepo(getPool(), identity, repoId);
  } catch (err) {
    console.error(`[repos] deleting a repo failed: ${errorClass(err)}`);
    return { ok: false, error: "Couldn't delete the repo. Try again." };
  }
  revalidatePath("/repos", "layout");
  redirect("/repos");
}
