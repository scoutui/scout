"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type DashboardConfig, type DashboardInput, DashboardInputSchema } from "@scoutui/web-shared";
import { auth } from "@/auth";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";
import type { ReadModelResult } from "@/lib/read-model-state";
import { isDerivedId } from "@/lib/derived-dashboards";
import { loadDashboardView, type DashboardView } from "@/lib/dashboard-load";

async function requireUserId(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "not_authenticated" };
  return { ok: true, userId: session.user.id };
}

export async function saveDashboard(untrusted: DashboardInput): Promise<{ ok: false; error: string }> {
  const gate = await requireUserId();
  if (!gate.ok) return gate;
  const parsed = DashboardInputSchema.safeParse(untrusted);
  if (!parsed.success) return { ok: false, error: "Couldn't save the chart. Reload the page and try again." };
  const input = parsed.data;
  if (input.id && isDerivedId(input.id)) return { ok: false, error: "cannot_edit_derived" };
  let savedId: string;
  try {
    // Server owns createdByUserId on create; on update the driver preserves the original creator.
    const saved = await getStorage().upsertDashboard({ ...input, createdByUserId: gate.userId });
    savedId = saved.id;
  } catch (err) {
    console.error("saveDashboard failed:", err);
    return { ok: false, error: "Couldn't save the chart. Try again." };
  }
  // Navigate from the action, not the client: the action response carries the
  // revalidation and the redirect together, so the current route's cache
  // refresh can't swallow a racing client-side push. redirect() throws, so it
  // must sit outside the try or the catch would eat it.
  revalidatePath("/charts");
  redirect(`/charts/${encodeURIComponent(savedId)}`);
}

export async function deleteDashboard(id: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireUserId();
  if (!gate.ok) return gate;
  if (isDerivedId(id)) return { ok: false, error: "cannot_delete_derived" };
  try {
    await getStorage().deleteDashboard(id);
    revalidatePath("/charts");
    return { ok: true };
  } catch (err) {
    console.error("deleteDashboard failed:", err);
    return { ok: false, error: "Couldn't delete the chart. Try again." };
  }
}

/**
 * Rejects when no one is signed in. The read-only actions below return data
 * shapes rather than an error result, so a signed-out call fails the way any
 * other failed read does.
 */
async function requireSignedIn(): Promise<void> {
  const gate = await requireUserId();
  if (!gate.ok) throw new Error(gate.error);
}

/**
 * Read-only projection for the builder's live preview. Returns data already
 * visible to the user and never sets createdByUserId.
 */
export async function previewDashboard(config: DashboardConfig): Promise<ReadModelResult<DashboardView>> {
  await requireSignedIn();
  return loadDashboardView(config);
}

/**
 * Repo-scoped picker sources: the components and packages in the repo's latest
 * scan, since most of the estate would project a flat-zero series there. Same
 * read-only stance as previewDashboard.
 */
export async function pickableForRepo(repoId: string): Promise<ReadModelResult<{
  components: Array<{ componentId: string; displayName: string; packageName: string | null }>;
  packages: string[];
}>> {
  await requireSignedIn();
  const result = await readModelPage(getStorage(), async snapshot => ({
    rows: await snapshot.listComponentsForRepo(repoId, ""),
    packageList: await snapshot.listPackages(repoId),
  }));
  if (result.state !== "ready") return result;
  const { rows, packageList } = result.value;
  const components = rows.map((r) => ({
    componentId: r.componentId,
    displayName: r.displayName,
    packageName: r.packageName,
  }));
  const packages = packageList
    .map((p) => p.packageName)
    .sort((a, b) => a.localeCompare(b));
  return { ...result, value: { components, packages } };
}
