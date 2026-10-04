"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ChartVisibility, ChartVisibilitySchema, type DashboardConfig, type DashboardInput, DashboardInputSchema } from "@scoutui/web-shared";
import { CHART_REFUSAL, can } from "@/lib/access";
import { identify, requireEditor } from "@/lib/identity";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";
import type { ReadModelResult } from "@/lib/read-model-state";
import { isDerivedId } from "@/lib/derived-dashboards";
import { loadDashboardView, type DashboardView } from "@/lib/dashboard-load";
import type { PickableComponent } from "@/components/dashboards/series-picker";

const ChartFormSchema = DashboardInputSchema.omit({ visibility: true, createdByUserId: true });

/** Creates a private chart, or saves over one, keeping who can open it. */
export async function saveDashboard(untrusted: Omit<DashboardInput, "visibility">): Promise<{ ok: false; error: string }> {
  const gate = await requireEditor();
  if (!gate.ok) return gate;
  const parsed = ChartFormSchema.safeParse(untrusted);
  if (!parsed.success) return { ok: false, error: "Couldn't save the chart. Reload the page and try again." };
  const input = parsed.data;
  if (input.id && isDerivedId(input.id)) return { ok: false, error: "cannot_edit_derived" };
  let savedId: string;
  try {
    const stored = input.id ? await getStorage().getDashboard(input.id) : null;
    if (stored && !can(await identify({ browser: true }), "edit", { chart: stored })) return { ok: false, error: CHART_REFUSAL };
    // Server owns createdByUserId on create; on update the driver preserves the original creator.
    const saved = await getStorage().upsertDashboard({ ...input, visibility: stored?.visibility ?? "private", createdByUserId: gate.userId });
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
  const gate = await requireEditor();
  if (!gate.ok) return gate;
  if (isDerivedId(id)) return { ok: false, error: "cannot_delete_derived" };
  try {
    const stored = await getStorage().getDashboard(id);
    if (stored && !can(await identify({ browser: true }), "edit", { chart: stored })) return { ok: false, error: CHART_REFUSAL };
    await getStorage().deleteDashboard(id);
    revalidatePath("/charts");
    return { ok: true };
  } catch (err) {
    console.error("deleteDashboard failed:", err);
    return { ok: false, error: "Couldn't delete the chart. Try again." };
  }
}

export async function setDashboardVisibility(id: string, visibility: ChartVisibility): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireEditor();
  if (!gate.ok) return gate;
  const parsed = ChartVisibilitySchema.safeParse(visibility);
  if (!parsed.success || isDerivedId(id)) return { ok: false, error: "Couldn't change who can see the chart. Reload the page and try again." };
  try {
    const stored = await getStorage().getDashboard(id);
    if (stored && !can(await identify({ browser: true }), "edit", { chart: stored })) return { ok: false, error: CHART_REFUSAL };
    await getStorage().setDashboardVisibility(id, parsed.data);
    revalidatePath("/charts");
    return { ok: true };
  } catch (err) {
    console.error("setDashboardVisibility failed:", err);
    return { ok: false, error: "Couldn't change who can see the chart. Try again." };
  }
}

/**
 * Read-only projection for the builder's live preview. Returns data already
 * visible to the user and never sets createdByUserId.
 */
export async function previewDashboard(config: DashboardConfig): Promise<ReadModelResult<DashboardView>> {
  if (!can(await identify({ browser: true }), "view")) throw new Error("not_authenticated");
  return loadDashboardView(config);
}

/**
 * Repo-scoped picker sources: the components and packages in the repo's latest
 * scan, since most of the estate would project a flat-zero series there. Same
 * read-only stance as previewDashboard.
 */
export async function pickableForRepo(repoId: string): Promise<ReadModelResult<{
  components: PickableComponent[];
  packages: string[];
}>> {
  if (!can(await identify({ browser: true }), "view")) throw new Error("not_authenticated");
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
    deprecated: r.deprecated,
  }));
  const packages = packageList
    .map((p) => p.packageName)
    .sort((a, b) => a.localeCompare(b));
  return { ...result, value: { components, packages } };
}
