import { getPool } from "@/db/client";
import { getStorage } from "@/lib/storage";
import { chartResultsNotice } from "@/lib/read-model-progress";
import { ChartResultsState } from "@/components/read-model-state";
import { TagsPanel } from "@/components/tags/tags-panel";
import { GovernanceManager } from "@/components/governance/governance-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Governance" };

export default async function GovernancePage() {
  const { records, tags, registry } = await getStorage().withReadSnapshot(async snapshot => ({
    records: await snapshot.listGovernance(),
    tags: await snapshot.listTags(),
    registry: await snapshot.getStoredRegistry(),
  }));
  const { stats, sources, repoCount } = registry ?? { stats: {}, sources: [], repoCount: 0 };
  const notice = await chartResultsNotice(getPool(), registry !== null);

  const countOf = (s: "active" | "complete" | "unseen") =>
    Object.values(stats).filter((x) => x.status === s).length;
  const active = countOf("active");
  const complete = countOf("complete");
  const unseen = countOf("unseen");

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Governance</h1>
        {registry ? <p className="text-xs tabular-nums text-muted-foreground">
          {active.toLocaleString()} active · {complete.toLocaleString()} complete
          {unseen > 0 ? ` · ${unseen.toLocaleString()} never matched a scan` : ""}
        </p> : null}
      </div>
      {notice ? <ChartResultsState notice={notice} besideNumbers={registry !== null} /> : null}

      {/* No h2: the records are the page. */}
      <section>
        <GovernanceManager
          records={records}
          sources={sources}
          stats={stats}
          repoCount={repoCount}
        />
      </section>

      <section className="max-w-xl space-y-4">
        <h2 className="text-base font-medium">Tags</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Optional labels for filtering and chart cohorts.
        </p>
        <TagsPanel allTags={tags} />
      </section>
    </div>
  );
}
