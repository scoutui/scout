import Link from "next/link";
import { Milestone, SearchX } from "lucide-react";
import type { GovernanceTracking } from "@scoutui/web-shared";
import { ReadModelState } from "@/components/read-model-state";
import type { ReadModelUnavailable } from "@/lib/read-model-state";
import { EmptyState } from "@/components/ui/empty-state";
import { TrackingList } from "@/components/dashboards/tracking-list";

export function RepoAdoptionPanel({ repoId, tracking, notice, canEdit }: {
  repoId: string;
  tracking: GovernanceTracking[] | null;
  notice: ReadModelUnavailable | null;
  canEdit: boolean;
}) {
  const entries = tracking ?? [];
  const [only] = entries;
  const unused = entries.length > 0 && entries.every((t) => t.coverage.total === 0);

  return (
    <div className="space-y-8 pt-4">
      {notice === null && entries.length === 0 ? (
        <EmptyState
          icon={<Milestone className="size-6" />}
          title="No migrations or retirements tracked yet."
          description={canEdit ? "Mark a component as replaced or retired in Governance to track its progress here." : undefined}
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
          {unused ? (
            <EmptyState
              icon={<SearchX className="size-6" />}
              title={`No scan of this repo has found a use of ${entries.length === 1 && only ? only.fromLabel : "a replaced component"}, so there's nothing to migrate.`}
            />
          ) : tracking ? (
            <TrackingList entries={tracking} scope={{ kind: "repo", repoId }} />
          ) : null}
        </>
      )}
    </div>
  );
}
