import Link from "next/link";
import { Milestone } from "lucide-react";
import type { GovernanceTracking } from "@scoutui/web-shared";
import { ReadModelState } from "@/components/read-model-state";
import type { ReadModelUnavailable } from "@/lib/read-model-state";
import { EmptyState } from "@/components/ui/empty-state";
import { TrackingSection } from "@/components/dashboards/tracking-rows";

export function RepoAdoptionPanel({ tracking, notice, canEdit }: {
  tracking: GovernanceTracking[] | null;
  notice: ReadModelUnavailable | null;
  canEdit: boolean;
}) {
  const entries = tracking ?? [];

  // Completed entries go to each section's collapsed "N complete" ledger, as on
  // the estate view: a migration visible on /charts but missing here would read
  // as data loss. A repo with no entries gets the empty state below; the notice
  // tells that apart from tracking data still being prepared.
  const migrations = entries.filter((t) => t.kind === "migration");
  const retirements = entries.filter((t) => t.kind === "retirement");
  // With a single active entry its chart is the tab's content, so it opens
  // expanded. Completed entries don't count: they sit in collapsed ledgers.
  const soloEntry = entries.filter((t) => t.active).length === 1;

  return (
    <div className="space-y-8 pt-4">
      {notice === null && entries.length === 0 ? (
        <EmptyState
          icon={<Milestone className="size-6" />}
          title="No migrations or retirements tracked yet."
          description={canEdit ? "Mark a component as replaced or retired and its progress will chart here, scan over scan." : undefined}
          action={
            canEdit ? (
              <Link href="/governance" className="text-sm text-foreground underline-offset-4 hover:underline">
                Open Governance
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {notice ? <ReadModelState {...notice} embedded besideNumbers={entries.length > 0} /> : null}
          {tracking ? (
            <>
              <TrackingSection
                kind="migration"
                entries={migrations.filter((t) => t.active)}
                complete={migrations.filter((t) => !t.active)}
                surface="repo"
                preExpand={soloEntry}
              />
              <TrackingSection
                kind="retirement"
                entries={retirements.filter((t) => t.active)}
                complete={retirements.filter((t) => !t.active)}
                surface="repo"
                preExpand={soloEntry}
              />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
