import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Clock, SearchX } from "lucide-react";
import { renderDashboard, type Dashboard, type DashboardMetric, type DashboardView, type GovernanceTracking } from "@scoutui/web-shared";
import { getPool } from "@/db/client";
import { getStorage } from "@/lib/storage";
import { chartResultsNotice, chartResultsUnavailable } from "@/lib/read-model-progress";
import { readModelPage, readModelTitle } from "@/lib/read-model-page";
import { ChartResultsState, ReadModelState, SkippedScansNotice } from "@/components/read-model-state";
import { DashboardChart } from "@/components/dashboards/dashboard-chart";
import { EmptyState } from "@/components/ui/empty-state";
import { DashboardScopeBadge } from "@/components/dashboards/dashboard-scope-badge";
import { DashboardMetricToggle } from "@/components/dashboards/dashboard-metric-toggle";
import { DeleteDashboardButton } from "@/components/dashboards/delete-dashboard-button";
import { CHART_KIND_LABEL } from "@/lib/dashboard-format";
import { chartSkippedNotices, loadChartDigests } from "@/lib/dashboard-load";
import { isEmptyView } from "@/lib/dashboard-chart-data";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ dashboardId: string }> }) {
  const { dashboardId } = await params;
  const id = decodeURIComponent(dashboardId);
  if (id.startsWith("migration:") || id.startsWith("retirement:")) return { title: "Chart" };
  const page = await readModelPage(getStorage(), snapshot => snapshot.getDashboard(id));
  if (page.state !== "ready") return { title: readModelTitle(page.state) };
  const dashboard = page.value;
  if (!dashboard) notFound();
  return { title: dashboard.name };
}

export default async function DashboardViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ dashboardId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dashboardId } = await params;
  const id = decodeURIComponent(dashboardId);
  const sp = await searchParams;
  // biome-ignore lint/complexity/useLiteralKeys: index-signature access requires bracket notation (noPropertyAccessFromIndexSignature)
  const rawMetric = sp["metric"];
  const metricParam = Array.isArray(rawMetric) ? rawMetric[0] : rawMetric;

  const governancePage = id.startsWith("migration:") || id.startsWith("retirement:");
  const page = await readModelPage(getStorage(), async snapshot => {
    if (governancePage) {
      return {
        kind: "tracking" as const,
        tracking: await snapshot.getStoredTracking({ kind: "all" }),
        registry: await snapshot.getStoredRegistry(),
        governance: await snapshot.listGovernance(),
      };
    }
    const dashboard = await snapshot.getDashboard(id);
    if (!dashboard) return null;
    const repoId = dashboard.config.scope.kind === "repo" ? dashboard.config.scope.repoId : undefined;
    return {
      kind: "saved" as const,
      dashboard,
      ...(await loadChartDigests(snapshot, dashboard.config)),
      tags: await snapshot.listTags(),
      governance: await snapshot.listGovernance(),
      missingRepo: repoId && !(await snapshot.getRepo(repoId))
        ? { repoId, missing: (await snapshot.listRepoIds()).includes(repoId) ? "scans" as const : "repo" as const }
        : null,
    };
  });
  if (page.state !== "ready") return <ReadModelState {...page} />;
  if (!page.value) notFound();
  let dashboard: Dashboard;
  let view: DashboardView;
  let derivedEntry: GovernanceTracking | null = null;
  let missingRepo: { repoId: string; missing: "scans" | "repo" } | null = null;
  if (page.value.kind === "tracking") {
    const { tracking, registry, governance } = page.value;
    const entry = tracking?.find((t) => t.id === id);
    if (!entry) {
      const recordId = id.slice(id.indexOf(":") + 1);
      const kind = id.startsWith("migration:") ? "superseded" : "retired";
      if (governance.some((r) => r.id === recordId && r.disposition.kind === kind) && !registry?.stats[recordId]) {
        return <ReadModelState {...await chartResultsUnavailable(getPool())} />;
      }
      notFound();
    }
    derivedEntry = entry;
    dashboard = {
      id,
      name: entry.name,
      description: null,
      config: entry.config,
      createdByUserId: null,
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
    };
    view = { kind: "series", series: entry.series };
  } else {
    const { digests, names, tags, governance } = page.value;
    missingRepo = page.value.missingRepo;
    dashboard = page.value.dashboard;
    const metricOverride: DashboardMetric =
      metricParam === "share" || metricParam === "count" ? metricParam : dashboard.config.metric;
    dashboard = { ...dashboard, config: { ...dashboard.config, metric: metricOverride } };
    view = renderDashboard(dashboard.config, digests, tags, governance, names);
  }
  const notice = derivedEntry ? await chartResultsNotice(getPool(), true) : null;
  const config = dashboard.config;
  const metric = config.metric;
  const skipped = page.value.kind === "saved" ? chartSkippedNotices(config, page) : { fallbacks: [], gaps: [] };

  const derived = governancePage;
  const showMetricToggle = !governancePage && config.chartType !== "stacked-share";

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/charts" className="transition-colors hover:text-foreground">
          Charts
        </Link>
        <span aria-hidden>/</span>
        <span className="max-w-[24rem] truncate">{dashboard.name}</span>
      </div>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {derivedEntry ? (
              <>
                {derivedEntry.kind === "migration" ? "Migration: " : "Retirement: "}
                <span className="font-mono">{derivedEntry.fromLabel}</span>
                {derivedEntry.toLabel ? (
                  <>
                    <span className="sr-only"> replaced by </span>
                    <span aria-hidden className="text-muted-foreground">
                      {" → "}
                    </span>
                    <span className="font-mono">{derivedEntry.toLabel}</span>
                  </>
                ) : null}
              </>
            ) : (
              dashboard.name
            )}
          </h1>
          {dashboard.description ? (
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">{dashboard.description}</p>
          ) : null}
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{CHART_KIND_LABEL[config.chartType]}</span>
            <DashboardScopeBadge scope={config.scope} missing={missingRepo?.missing} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showMetricToggle ? <DashboardMetricToggle metric={metric} /> : null}
          {!derived ? (
            <>
              <Link href={`/charts/${encodeURIComponent(dashboard.id)}/edit`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Edit
              </Link>
              <DeleteDashboardButton id={dashboard.id} />
            </>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="mb-6">
          <ChartResultsState notice={notice} besideNumbers />
        </div>
      ) : null}
      {skipped.gaps.length || skipped.fallbacks.length ? (
        <div className="mb-6">
          <SkippedScansNotice {...skipped} />
        </div>
      ) : null}

      {missingRepo?.missing === "scans" ? (
        <EmptyState
          icon={<Clock className="size-6" />}
          title="This chart's repo has no scans yet."
          description={`This chart fills in once the first scan of ${missingRepo.repoId} is uploaded.`}
        />
      ) : missingRepo?.missing === "repo" ? (
        <EmptyState
          icon={<AlertTriangle className="size-6" />}
          title="This chart's repo no longer exists."
          description={`There are no scans for ${missingRepo.repoId} any more. It may have been renamed or deleted. Edit the chart to pick another repo, or delete it.`}
        />
      ) : isEmptyView(view) ? (
        <EmptyState
          icon={<SearchX className="size-6" />}
          title="Couldn't find the components in this chart."
          description="Edit the chart to pick them again."
        />
      ) : (
        /* A table runs flush to the panel edge; plotted charts sit inset. */
        <div className={config.chartType === "table" ? "panel overflow-hidden" : "panel p-4"}>
          <DashboardChart config={config} view={view} />
        </div>
      )}

      {derived ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Created from a Governance record.{" "}
          <Link href="/governance" className="underline underline-offset-2 transition-colors hover:text-foreground">
            Manage records
          </Link>{" "}
          in Governance.
        </p>
      ) : null}
    </div>
  );
}
