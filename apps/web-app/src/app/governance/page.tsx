import { getPool } from "@/db/client";
import { getStorage } from "@/lib/storage";
import { chartResultsNotice } from "@/lib/read-model-progress";
import { progressLabel } from "@/lib/governance-map";
import { ChartResultsState } from "@/components/read-model-state";
import { TagsPanel } from "@/components/tags/tags-panel";
import { GovernanceManager } from "@/components/governance/governance-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Governance" };

export default async function GovernancePage() {
  const { records, authors, tags, registry } = await getStorage().withReadSnapshot(async snapshot => ({
    records: await snapshot.listGovernance(),
    authors: await snapshot.listGovernanceAuthors(),
    tags: await snapshot.listTags(),
    registry: await snapshot.getStoredRegistry(),
  }));
  const { sources, repoCount } = registry ?? { sources: [], repoCount: 0 };
  const editedSinceResults = new Set(
    registry ? records.filter((r) => new Date(r.updatedAt) > new Date(registry.snapshotAt)).map((r) => r.id) : [],
  );
  const stats = Object.fromEntries(Object.entries(registry?.stats ?? {}).filter(([id]) => !editedSinceResults.has(id)));
  const notice = await chartResultsNotice(getPool(), registry !== null);

  const countOf = (s: "active" | "complete" | "unseen") =>
    Object.values(stats).filter((x) => x.status === s).length;
  const active = countOf("active");
  const complete = countOf("complete");
  const unseen = countOf("unseen");
  const packageNames = registry
    ? [...new Set(sources.map((s) => s.packageName))].sort((a, b) => a.localeCompare(b))
    : null;

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <GovernanceManager
        records={records}
        sources={sources}
        stats={stats}
        repoCount={repoCount}
        summary={registry ? progressLabel({ inProgress: active, complete, unseen }) : null}
        authors={authors}
        notice={notice ? <ChartResultsState notice={notice} besideNumbers={registry !== null} /> : null}
      />

      <section id="tags" aria-labelledby="tags-title" className="scroll-mt-24">
        <TagsPanel allTags={tags} packageNames={packageNames} />
      </section>
    </div>
  );
}
