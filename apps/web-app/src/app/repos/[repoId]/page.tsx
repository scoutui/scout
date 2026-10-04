import { notFound } from "next/navigation";
import { Layers } from "lucide-react";
import { isOlderScan } from "@/lib/scan-switcher";
import { getPool } from "@/db/client";
import { getStorage } from "@/lib/storage";
import { chartResultsNotice } from "@/lib/read-model-progress";
import { readModelPage } from "@/lib/read-model-page";
import { ReadModelState, SkippedScansNotice } from "@/components/read-model-state";
import { RepoDetailHeader } from "@/components/repos/repo-detail-header";
import { RepoTabs } from "@/components/repos/repo-tabs";
import { RepoAdoptionPanel } from "@/components/repos/repo-adoption-panel";
import { ComponentsExplorer } from "@/components/repos/components-explorer";
import { ViewingOlderScanBanner } from "@/components/repos/viewing-older-scan-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access";
import { identify } from "@/lib/identity";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const decoded = decodeURIComponent(repoId);
  const page = await readModelPage(getStorage(), snapshot => snapshot.getRepoHead(decoded));
  if (page.state !== "ready") return { title: decoded };
  // The loading skeleton has already streamed with a 200, so this shows the
  // not-found page without changing the status.
  if (!page.value) notFound();
  return { title: decoded };
}

export default async function RepoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ repoId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { repoId: rawRepoId } = await params;
  // repoIds can contain "/" (monorepo per-app ids such as "example-monorepo/web").
  // The link encodes it as %2F and Next.js leaves the param encoded, so decode it
  // to match stored ids and so later encodeURIComponent links don't double-encode.
  const repoId = decodeURIComponent(rawRepoId);
  const raw = await searchParams;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation
  const scan = raw["scan"];
  const scanId = typeof scan === "string" && scan.length > 0 ? scan : undefined;

  const page = await readModelPage(getStorage(), async snapshot => {
    const detail = await snapshot.getRepo(repoId, scanId);
    if (!detail) return null;
    const recentScans = await snapshot.listScans(repoId);
    const rows = await snapshot.listComponentsForRepo(repoId, "", scanId);
    const latestIds = isOlderScan(scanId, recentScans[0]?.scanId, detail.scanId)
      ? new Set((await snapshot.listComponentsForRepo(repoId, "")).map(row => row.componentId))
      : null;
    const notInLatest = latestIds ? rows.filter(row => !latestIds.has(row.componentId)).map(row => row.componentId) : [];
    const governance = await snapshot.listGovernance();
    const tracking = await snapshot.getStoredTracking({ kind: "repo", repoId });
    return { detail, recentScans, rows, notInLatest, governance, tracking };
  });
  if (page.state !== "ready") return <ReadModelState {...page} heading={{ title: repoId, code: true, back: { href: "/repos", label: "Repos" } }} />;
  if (!page.value) notFound();
  const { detail, recentScans, rows, notInLatest, governance, tracking } = page.value;
  if (!detail) notFound();
  const canEdit = can(await identify({ browser: true }), "edit");

  // listScans puts the latest scan first.
  const showOlderScanBanner = isOlderScan(scanId, recentScans[0]?.scanId, detail.scanId);

  return (
    <div className="space-y-6">
      {showOlderScanBanner ? (
        <ViewingOlderScanBanner repoId={repoId} committedAt={detail.committedAt} arrivedAt={detail.arrivedAt} />
      ) : null}
      <RepoDetailHeader detail={detail} recentScans={recentScans} />
      <SkippedScansNotice fallbacks={page.fallbacks} ownPage />
      <RepoTabs
        components={
          <div className="pt-4">
            {rows.length === 0 ? (
              <EmptyState
                icon={<Layers className="size-6" />}
                title="No components found"
                description="This scan found no components. Check the include patterns in scout.config.json, then scan again."
              />
            ) : <ComponentsExplorer repoId={repoId} rows={rows} notInLatest={notInLatest} deprecatedTotal={detail.deprecatedCount} diff={detail.diff} canEdit={canEdit} />}
          </div>
        }
        adoption={
          <RepoAdoptionPanel tracking={tracking} canEdit={canEdit}
            notice={governance.length > 0 ? (await chartResultsNotice(getPool(), tracking !== null))?.unavailable ?? null : null} />
        }
      />
    </div>
  );
}
