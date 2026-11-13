
import { BackLink } from "@/components/ui/back-link";
import { AlertTriangle } from "lucide-react";
import type { CrossRepoComponentDetail } from "@scoutui/web-shared";
import { friendlyKind, plural } from "@scoutui/web-shared/client";
import { kindLabel, ORIGIN_LABEL } from "@/lib/component-facets";
import { MigrationLine } from "@/components/governance/migration-line";
import { versionRangeLabel } from "@/lib/version-order";

export function CrossRepoHeader({ detail, canEdit }: { detail: CrossRepoComponentDetail; canEdit: boolean }) {
  const versions = versionRangeLabel(detail.versionRange);
  const deprecatedRepoCount = detail.usages.filter(u => u.deprecated).length;
  const repoNoun = detail.repoCount === 1 ? "repo" : "repos";

  return (
    <header className="space-y-4">
      <div className="space-y-2">
        {detail.packageName ? (
          <BackLink href={`/packages/${encodeURIComponent(detail.packageName)}`} code>{detail.packageName}</BackLink>
        ) : null}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-mono text-2xl font-semibold">{detail.displayName}</h1>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{kindLabel(friendlyKind(detail.kind))}</span>
          {detail.scope === "local" ? (<><Sep /><span>{ORIGIN_LABEL.local}</span></>) : null}
          <Sep />
          <span className="tabular-nums">{detail.repoCount.toLocaleString()} {repoNoun}</span>
          <Sep />
          {versions ? (<><span className="font-mono tabular-nums" title={plural(detail.distinctVersionCount, "version")}>{versions}</span><Sep /></>) : null}
          <span className="tabular-nums">{plural(detail.totalOccurrences, "use")}</span>
        </div>
      </div>

      {deprecatedRepoCount > 0 ? (
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs text-status-warn-text">
            <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
            deprecated in{" "}
            <span className="font-medium tabular-nums">{deprecatedRepoCount.toLocaleString()}</span>
            of {detail.repoCount.toLocaleString()} {repoNoun}
          </span>
        </div>
      ) : null}

      <MigrationLine status={detail.migrationStatus} recordId={canEdit ? detail.governedByRecordId : null} />
    </header>
  );
}

function Sep() {
  return <span aria-hidden className="text-faint">·</span>;
}
