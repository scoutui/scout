import { notFound } from "next/navigation";
import { governingRecord, resolveGovernance, resolveTags } from "@scoutui/web-shared";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";
import { ReadModelState, SkippedScansNotice } from "@/components/read-model-state";
import { PackageDetailHeader } from "@/components/packages/package-detail-header";
import { PackageConsumersTable } from "@/components/packages/package-consumers-table";
import { PackageComponentsTable } from "@/components/packages/package-components-table";
import { MigrationLine } from "@/components/governance/migration-line";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ packageName: string }> }) {
  const { packageName } = await params;
  const decoded = decodeURIComponent(packageName);
  const page = await readModelPage(getStorage(), snapshot => snapshot.getPackage(decoded));
  if (page.state !== "ready") return { title: decoded };
  const detail = page.value;
  if (!detail) notFound();
  return { title: decoded };
}

export default async function PackageDetailPage({
  params,
}: {
  params: Promise<{ packageName: string }>;
}) {
  const { packageName } = await params;
  // Next.js keeps `%2F` encoded in a single dynamic segment, so a scoped package
  // like `@example/ui` arrives as `%40example%2Fui`: decode before lookup.
  const page = await readModelPage(getStorage(), async snapshot => ({
    pkg: await snapshot.getPackage(decodeURIComponent(packageName)),
    tags: await snapshot.listTags(),
    governance: await snapshot.listGovernance(),
  }));
  if (page.state !== "ready") return (
    <ReadModelState {...page}
      heading={{ title: decodeURIComponent(packageName), code: true, back: { href: "/packages", label: "Packages" } }} />
  );
  const { pkg, tags, governance } = page.value;
  const detail = pkg ? { ...pkg, tags: resolveTags(pkg.packageName, tags) } : pkg;
  if (!detail) notFound();

  const decodedName = decodeURIComponent(packageName);
  const packageRecord = governingRecord({ packageName: decodedName, name: null }, governance);

  return (
    <div className="space-y-6">
      <PackageDetailHeader detail={detail} allTags={tags} />
      <SkippedScansNotice fallbacks={page.fallbacks} />
      <MigrationLine
        status={resolveGovernance({ packageName: decodedName, name: null }, governance)}
        recordId={packageRecord?.id ?? null}
      />
      <Section title="Used in">
        <PackageConsumersTable cells={detail.cells} packageName={detail.packageName} />
      </Section>
      <Section title="Components">
        {/* No key needed: the table reads its filters from the live ?q= through
            useQuerySyncedState. */}
        <PackageComponentsTable components={detail.components} />
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
