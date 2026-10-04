import Link from "next/link";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import type { ComponentDetail } from "@scoutui/web-shared";
import { friendlyKind } from "@scoutui/web-shared/client";
import { Badge } from "@/components/ui/badge";
import { MigrationLine } from "@/components/governance/migration-line";
import { KIND_LABEL, NO_PACKAGE_TITLE, ORIGIN_DESCRIPTION, ORIGIN_LABEL } from "@/lib/component-facets";
import { cn } from "@/lib/utils";

export function ComponentDetailHeader({ detail, canEdit }: { detail: ComponentDetail; canEdit: boolean }) {
  return (
    <header className="space-y-2">
      <div className="text-xs text-muted-foreground">
        <Link
          href={`/repos/${encodeURIComponent(detail.repoId)}`}
          className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft aria-hidden className="size-3" />
          <span className="font-mono">{detail.repoId}</span>
        </Link>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 className="font-mono text-2xl font-semibold">{detail.displayName}</h1>
        <Badge variant={detail.scope === "local" ? "outline" : "secondary"} title={ORIGIN_DESCRIPTION[detail.scope]}>
          {ORIGIN_LABEL[detail.scope]}
        </Badge>
        <Badge variant="outline">{KIND_LABEL[friendlyKind(detail.kind)]}</Badge>
        {detail.deprecated ? (
          <Badge variant="warning">
            <AlertTriangle aria-hidden />
            {/* The word, not the icon, sets the badge's baseline, so the badge
                lines up with the badges beside it. */}
            <span className="self-baseline leading-3.5">Deprecated</span>
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          From <span className="font-mono" title={detail.packageName ? undefined : NO_PACKAGE_TITLE}>{detail.packageName ?? "—"}</span>
        </span>
        {detail.publicEntry ? (<><Sep /><span className="font-mono">{detail.publicEntry}</span></>) : null}
        {detail.version ? (<><Sep /><span className="font-mono">v{detail.version}</span></>) : null}
        {detail.definedAt ? (
          <>
            {/* Below sm the path always starts its own line, so it needs no separator. */}
            <Sep className="max-sm:hidden" />
            <span className="wrap-anywhere max-sm:basis-full">
              defined at{" "}
              <span className="font-mono">{detail.definedAt.filePath}:{detail.definedAt.line}:{detail.definedAt.column}</span>
            </span>
          </>
        ) : null}
      </div>
      <MigrationLine status={detail.migrationStatus} recordId={canEdit ? detail.governedByRecordId : null} />
    </header>
  );
}

// Not `text-border`: it measured 1.15:1 against the panel, which is invisible.
function Sep({ className }: { className?: string }) {
  return <span aria-hidden className={cn("text-muted-foreground/60", className)}>·</span>;
}

