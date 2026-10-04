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
import { buttonVariants } from "@/components/ui/button";
import { CHART_REFUSAL, can } from "@/lib/access";
import { identify } from "@/lib/identity";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit chart" };

export default async function EditDashboardPage({ params }: { params: Promise<{ dashboardId: string }> }) {
  const { dashboardId } = await params;
  const id = decodeURIComponent(dashboardId);
  if (isDerivedId(id)) notFound();
  const identity = await identify({ browser: true });
  if (!can(identity, "edit")) {
    return <EmptyState titleAs="h1" title="Only Editors can change charts. Ask an Admin for access." />;
  }
  const page = await readModelPage(getStorage(), async snapshot => {
    const dashboard = await snapshot.getDashboard(id);
    return dashboard ? { dashboard, options: await chartBuilderOptions(snapshot) } : null;
  });
  if (page.state !== "ready") return <ReadModelState {...page} />;
  if (!page.value) notFound();
  const { dashboard, options } = page.value;
  if (!can(identity, "view", { chart: dashboard })) return privateChart(dashboard);
  if (!can(identity, "edit", { chart: dashboard })) {
    return (
      <EmptyState
        titleAs="h1"
        title={CHART_REFUSAL}
        action={
          <Link href={`/charts/new?from=${encodeURIComponent(dashboard.id)}`} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
            Duplicate
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/charts" className="transition-colors hover:text-foreground">
          Charts
        </Link>
        <span aria-hidden>/</span>
        <Link href={`/charts/${encodeURIComponent(dashboard.id)}`} className="max-w-[24rem] truncate transition-colors hover:text-foreground">
          {dashboard.name}
        </Link>
        <span aria-hidden>/</span>
        <span>Edit</span>
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-headline">Edit chart</h1>
      <DashboardBuilder
        {...options}
        saved={{ id: dashboard.id, name: dashboard.name, description: dashboard.description, config: dashboard.config, visibility: dashboard.visibility }}
      />
    </div>
  );
}
