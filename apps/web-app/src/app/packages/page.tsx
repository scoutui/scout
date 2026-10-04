import { AlertTriangle, Package } from "lucide-react";
import { attachTags } from "@scoutui/web-shared";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";
import { ReadModelState, SkippedScansNotice } from "@/components/read-model-state";
import { EmptyState } from "@/components/ui/empty-state";
import { FirstScanCta } from "@/components/ui/first-scan-cta";
import { PackagesExplorer } from "@/components/packages/packages-explorer";
import { can } from "@/lib/access";
import { identify } from "@/lib/identity";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packages" };

export default async function PackagesPage() {
  const page = await readModelPage(getStorage(), async snapshot => ({
    rows: await snapshot.listPackages(), tags: await snapshot.listTags(),
  }));
  if (page.state !== "ready") return <ReadModelState {...page} heading={{ title: "Packages" }} />;
  const { rows, tags } = page.value;
  const decorated = attachTags(rows, tags);
  const multiVersion = decorated.filter(r => r.distinctVersionCount > 1).length;
  const withDeprecated = decorated.filter(r => r.deprecatedCount > 0).length;
  const canEdit = can(await identify({ browser: true }), "edit");

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Packages</h1>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{decorated.length.toLocaleString()} {decorated.length === 1 ? "package" : "packages"}</span>
          {multiVersion > 0 ? (
            <>
              <Sep />
              <span>
                <span className="tabular-nums">{multiVersion.toLocaleString()}</span> on multiple versions
              </span>
            </>
          ) : null}
        </div>
        {withDeprecated > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-status-warn-text">
            <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
            <span className="font-medium tabular-nums">{withDeprecated.toLocaleString()}</span>
            {withDeprecated === 1 ? "package with deprecated components in use" : "packages with deprecated components in use"}
          </span>
        ) : null}
      </header>
      <SkippedScansNotice fallbacks={page.fallbacks} />
      {decorated.length === 0 ? (
        <EmptyState
          icon={<Package className="size-6" />}
          title="No packages tracked yet."
          description="Packages appear once a scanned repo is uploaded."
          action={<FirstScanCta />}
        />
      ) : (
        /* No key needed: the explorer reads its facets from the live URL
           through useQueryParamsState. */
        <PackagesExplorer rows={decorated} canEdit={canEdit} />
      )}
    </div>
  );
}

function Sep() {
  return <span aria-hidden className="text-border">·</span>;
}
