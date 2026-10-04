import Link from "next/link";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import type { CrossRepoComponentDetail } from "@scoutui/web-shared";
import { frameworkLabel } from "@/lib/framework-label";
import { ORIGIN_LABEL } from "@/lib/component-facets";
import { MigrationLine } from "@/components/governance/migration-line";
import { VersionComposition, computeVersionShare } from "@/components/viz/version-composition";

export function CrossRepoHeader({ detail, canEdit }: { detail: CrossRepoComponentDetail; canEdit: boolean }) {
  const versionShare = computeVersionShare(detail.usages, detail.distinctVersionCount);
  const deprecatedRepoCount = detail.usages.filter(u => u.deprecated).length;
  const repoNoun = detail.repoCount === 1 ? "repo" : "repos";

  return (
    <header className="space-y-4">
      <div className="space-y-2">
        {detail.packageName ? (
          <Link
            href={`/packages/${encodeURIComponent(detail.packageName)}`}
            className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft aria-hidden className="size-3" />
            <span className="font-mono">{detail.packageName}</span>
          </Link>
        ) : null}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-mono text-2xl font-semibold">{detail.displayName}</h1>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{frameworkLabel(detail.kind)}</span>
          {detail.scope === "local" ? (<><Sep /><span>{ORIGIN_LABEL.local}</span></>) : null}
          <Sep />
          <span className="tabular-nums">{detail.repoCount.toLocaleString()} {repoNoun}</span>
          <Sep />
          <span className="tabular-nums">{detail.totalOccurrences.toLocaleString()} uses</span>
        </div>
      </div>

      {/* Which versions this component's usage sits on, across every
          consuming repo. */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <VersionComposition share={versionShare} />

        {deprecatedRepoCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-status-warn-text">
            <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
            deprecated in{" "}
            <span className="font-medium tabular-nums">{deprecatedRepoCount.toLocaleString()}</span>
            of {detail.repoCount.toLocaleString()} {repoNoun}
          </span>
        ) : null}
      </div>

      <MigrationLine status={detail.migrationStatus} recordId={canEdit ? detail.governedByRecordId : null} />
    </header>
  );
}

function Sep() {
  return <span aria-hidden className="text-muted-foreground/60">·</span>;
}
