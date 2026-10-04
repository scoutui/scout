import Link from "next/link";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import type { PackageDetail, Tag } from "@scoutui/web-shared";
import { frameworkLabel } from "@/lib/framework-label";
import { TagChips } from "@/components/tags/tag-chip";
import { QuickTag } from "@/components/tags/quick-tag";
import { VersionComposition, computeVersionShare } from "@/components/viz/version-composition";

export function PackageDetailHeader({
  detail,
  allTags = [],
  canEdit,
}: {
  detail: PackageDetail;
  allTags?: Tag[];
  canEdit: boolean;
}) {
  // A package is single-framework, so derive it once from its components and
  // show it here instead of repeating a uniform "Kind" column on every row.
  const frameworks = [...new Set(detail.components.map(c => c.kind))]
    .map(frameworkLabel)
    .join(" · ");

  const versionShare = computeVersionShare(detail.cells, detail.distinctVersionCount);

  return (
    <header className="space-y-4">
      <div className="space-y-2">
        <Link
          href="/packages"
          className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-3" />
          Packages
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-mono text-2xl font-semibold">{detail.packageName}</h1>
          <span className="flex items-center gap-1.5">
            {detail.tags?.length ? <TagChips tags={detail.tags} max={4} /> : null}
            {canEdit ? <QuickTag packageName={detail.packageName} allTags={allTags} /> : null}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {frameworks ? (<><span>{frameworks}</span><Sep /></>) : null}
          <span className="tabular-nums">{detail.consumerCount.toLocaleString()} {detail.consumerCount === 1 ? "repo" : "repos"}</span>
          <Sep />
          <span className="tabular-nums">{detail.componentCount.toLocaleString()} components</span>
          <Sep />
          <span className="tabular-nums">{detail.totalOccurrences.toLocaleString()} uses</span>
        </div>
      </div>

      {/* Version composition and the deprecated alarm */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <VersionComposition share={versionShare} />

        {detail.deprecatedCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-status-warn-text">
            <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
            <span className="font-medium tabular-nums">{detail.deprecatedCount.toLocaleString()}</span>
            {detail.deprecatedCount === 1 ? "deprecated component in use" : "deprecated components in use"}
          </span>
        ) : null}
      </div>
    </header>
  );
}

function Sep() {
  return <span aria-hidden className="text-border">·</span>;
}
