import { notFound } from "next/navigation";
import { getStorage } from "@/lib/storage";
import { readModelPage, readModelTitle } from "@/lib/read-model-page";
import { ReadModelState, SkippedScansNotice } from "@/components/read-model-state";
import { CrossRepoHeader } from "@/components/components-tab/cross-repo-header";
import { CrossRepoUsedInTable } from "@/components/components-tab/cross-repo-used-in-table";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ componentId: string }> }) {
  const { componentId } = await params;
  const page = await readModelPage(getStorage(), snapshot => snapshot.getCrossRepoComponent(decodeURIComponent(componentId)));
  if (page.state !== "ready") return { title: readModelTitle(page.state) };
  const detail = page.value;
  if (!detail) notFound();
  return { title: detail.displayName };
}

export default async function CrossRepoComponentPage({
  params,
}: {
  params: Promise<{ componentId: string }>;
}) {
  const { componentId } = await params;
  const page = await readModelPage(getStorage(), snapshot => snapshot.getCrossRepoComponent(decodeURIComponent(componentId)));
  if (page.state !== "ready") return <ReadModelState {...page} />;
  const detail = page.value;
  if (!detail) notFound();

  return (
    <div className="space-y-6">
      <CrossRepoHeader detail={detail} />
      <SkippedScansNotice fallbacks={page.fallbacks} />
      <Section title="Used in">
        <CrossRepoUsedInTable componentId={detail.componentId} usages={detail.usages} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-label text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}
