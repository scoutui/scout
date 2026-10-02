import { notFound } from "next/navigation";
import { compositionNeighbourhood } from "@scoutui/web-shared";
import { getStorage } from "@/lib/storage";
import { readModelPage, readModelTitle } from "@/lib/read-model-page";
import { ReadModelState, SkippedScansNotice } from "@/components/read-model-state";
import { parseGitRemote } from "@scoutui/scan-format/git-remote";
import { ComponentDetailHeader } from "@/components/component-detail/component-detail-header";
import { DetailTabs } from "@/components/component-detail/detail-tabs";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ repoId: string; componentId: string }>;
}) {
  const { repoId, componentId } = await params;
  const page = await readModelPage(getStorage(), snapshot => snapshot.getComponentDetailHead(
    decodeURIComponent(repoId),
    decodeURIComponent(componentId),
  ));
  if (page.state !== "ready") return { title: readModelTitle(page.state) };
  const detail = page.value;
  if (!detail) notFound();
  return { title: detail.displayName };
}

export default async function ComponentDetailPage({
  params,
}: {
  params: Promise<{ repoId: string; componentId: string }>;
}) {
  const { repoId: rawRepoId, componentId: rawComponentId } = await params;
  // repoIds can contain "/" (monorepo per-app ids); both params arrive %2F-encoded.
  const repoId = decodeURIComponent(rawRepoId);
  const componentId = decodeURIComponent(rawComponentId);

  const page = await readModelPage(getStorage(), async snapshot => {
    const head = await snapshot.getComponentDetailHead(repoId, componentId);
    if (!head) return null;
    const occurrences = await snapshot.getComponentUsage(repoId, componentId);
    const repo = await snapshot.getRepoHead(repoId);
    const graph = await snapshot.getCompositionGraph(repoId);
    return { detail: { ...head, occurrences }, repo, graph: graph && compositionNeighbourhood(graph, componentId) };
  });
  if (page.state !== "ready") return <ReadModelState {...page} />;
  if (!page.value) notFound();
  const { detail, repo, graph } = page.value;
  if (!detail) notFound();

  // Repo remote + commit let occurrences deep-link to the exact source line.
  // Null when the repo has no browseable remote, and the path renders as text.
  const source = repo
    ? { remote: parseGitRemote(repo.gitRemote), commit: repo.commit }
    : null;

  return (
    <div className="space-y-6">
      <ComponentDetailHeader detail={detail} />
      <SkippedScansNotice fallbacks={page.fallbacks} ownPage />
      <DetailTabs detail={detail} graph={graph ?? { nodes: [], edges: [] }} source={source} />
    </div>
  );
}
