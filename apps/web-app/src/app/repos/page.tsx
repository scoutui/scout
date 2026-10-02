import { FolderOpen } from "lucide-react";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";
import { ReadModelState, SkippedScansNotice } from "@/components/read-model-state";
import { EmptyState } from "@/components/ui/empty-state";
import { FirstScanCta } from "@/components/ui/first-scan-cta";
import { ReposExplorer } from "@/components/repos/repos-explorer";

export const dynamic = "force-dynamic"; // always re-read storage
export const metadata = { title: "Repos" };

export default async function ReposPage() {
  const page = await readModelPage(getStorage(), snapshot => snapshot.listRepos());
  if (page.state !== "ready") return <ReadModelState {...page} heading={{ title: "Repos" }} />;
  const rows = page.value;
  const totalScans = rows.reduce((n, r) => n + r.scanCount, 0);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Repos</h1>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{rows.length.toLocaleString()} {rows.length === 1 ? "repo" : "repos"}</span>
          <Sep />
          <span className="tabular-nums">{totalScans.toLocaleString()} {totalScans === 1 ? "scan" : "scans"}</span>
        </div>
      </header>
      <SkippedScansNotice fallbacks={page.fallbacks} />
      {rows.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="size-6" />}
          title="No repos scanned yet."
          description="Repos appear here once a scan is uploaded."
          action={<FirstScanCta />}
        />
      ) : (
        /* No key needed: the explorer reads its search text from the live ?q=
           through useQuerySyncedState. */
        <ReposExplorer rows={rows} />
      )}
    </div>
  );
}

function Sep() {
  return <span aria-hidden className="text-border">·</span>;
}
