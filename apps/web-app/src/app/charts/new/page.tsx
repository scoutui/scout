import Link from "next/link";
import { notFound } from "next/navigation";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";
import { chartBuilderOptions } from "@/lib/chart-builder-options";
import { isDerivedId } from "@/lib/derived-dashboards";
import { ReadModelState } from "@/components/read-model-state";
import { DashboardBuilder } from "@/components/dashboards/dashboard-builder";
import { privateChart } from "@/components/dashboards/private-chart";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access";
import { identify } from "@/lib/identity";

export const dynamic = "force-dynamic";
export const metadata = { title: "New chart" };

/** The chart builder, empty or, with `?from=<id>`, holding a copy of that chart. */
export default async function NewDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const identity = await identify({ browser: true });
  if (!can(identity, "edit")) {
    return <EmptyState titleAs="h1" title="Only Editors can make charts. Ask an Admin for access." />;
  }
  const rawFrom = (await searchParams).from;
  const from = Array.isArray(rawFrom) ? rawFrom[0] : rawFrom;
  if (from !== undefined && isDerivedId(from)) notFound();
  const page = await readModelPage(getStorage(), async snapshot => ({
    options: await chartBuilderOptions(snapshot),
    source: from === undefined ? null : await snapshot.getDashboard(from),
  }));
  if (page.state !== "ready") return <ReadModelState {...page} />;
  const { options, source } = page.value;
  if (from !== undefined && !source) notFound();
  if (source && !can(identity, "view", { chart: source })) return privateChart(source);

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/charts" className="transition-colors hover:text-foreground">
          Charts
        </Link>
        <span aria-hidden>/</span>
        <span>New chart</span>
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-headline">New chart</h1>
      {source ? (
        <DashboardBuilder
          {...options}
          saved={{ id: source.id, name: `Copy of ${source.name}`, description: source.description, config: source.config }}
          duplicate
        />
      ) : (
        <DashboardBuilder {...options} />
      )}
    </div>
  );
}
