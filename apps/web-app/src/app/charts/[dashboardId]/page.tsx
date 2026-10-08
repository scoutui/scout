import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, Clock, SearchX } from "lucide-react";
import { cohortChange, componentDisambiguators, renderDashboard, type Dashboard, type DashboardMetric, type DashboardView, type GovernanceTracking } from "@scoutui/web-shared";
import { getPool } from "@/db/client";
import { getStorage } from "@/lib/storage";
import { chartResultsNotice, chartResultsUnavailable } from "@/lib/read-model-progress";
import { readModelPage, readModelTitle } from "@/lib/read-model-page";
import { ChartResultsState, ReadModelState, SkippedScansNotice } from "@/components/read-model-state";
import { ChartTitleLabel } from "@/components/dashboards/chart-title-label";
import { LinkedDashboardChart } from "@/components/dashboards/dashboard-chart";
import { EmptyState } from "@/components/ui/empty-state";
import { DashboardScopeBadge } from "@/components/dashboards/dashboard-scope-badge";
import { DashboardMetricToggle } from "@/components/dashboards/dashboard-metric-toggle";
import { ChartExportProvider } from "@/components/dashboards/chart-export-context";
import { ChartMenu } from "@/components/dashboards/chart-menu";
import { ChartVisibilityLabel } from "@/components/dashboards/chart-visibility";
import { DeleteDashboardButton } from "@/components/dashboards/delete-dashboard-button";
import { privateChart } from "@/components/dashboards/private-chart";
import { TrackingReadout } from "@/components/dashboards/tracking-rows";
import { CHART_KIND_LABEL } from "@/lib/dashboard-format";
import { chartSkippedNotices, loadChartDigests } from "@/lib/dashboard-load";
import { chartRange, isEmptyView } from "@/lib/dashboard-chart-data";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/lib/access";
import { identify } from "@/lib/identity";
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
  if (!can(await identify({ browser: true }), "view", { chart: dashboard })) return { title: "Private chart" };
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
  // biome-ignore lint/complexity/useLiteralKeys: index-signature access requires bracket notation (noPropertyAccessFromIndexSignature)
  const rangeParam = chartRange(sp["range"]);

  const governancePage = id.startsWith("migration:") || id.startsWith("retirement:");
  const identity = await identify({ browser: true });
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
    if (!can(identity, "view", { chart: dashboard })) return { kind: "private" as const, createdBy: dashboard.createdBy, creatorRemoved: dashboard.creatorRemoved };
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
  if (page.value.kind === "private") return privateChart(page.value);
  let dashboard: Dashboard;
  let view: DashboardView;
  let derivedEntry: GovernanceTracking | null = null;
  let missingRepo: { repoId: string; missing: "scans" | "repo" } | null = null;
  let change: Record<string, number | null> | undefined;
  let paths: Record<string, string> = {};
  if (page.value.kind === "tracking") {
    const { tracking, registry, governance } = page.value;
    const entry = tracking?.find((t) => t.id === id);
    if (!entry) {
      const recordId = id.slice(id.indexOf(":") + 1);
      const kind = id.startsWith("migration:") ? "superseded" : "retired";
      const charting = tracking?.find((t) => id.startsWith(`${t.kind}:`) && t.recordIds.includes(recordId));
      if (charting) redirect(`/charts/${encodeURIComponent(charting.id)}`);
      if (governance.some((r) => r.id === recordId && r.disposition.kind === kind) && !registry?.stats[recordId]) {
        return <ReadModelState {...await chartResultsUnavailable(getPool())} />;
      }
      notFound();
    }
    if (!governance.some((r) => entry.recordIds.includes(r.id))) notFound();
    derivedEntry = entry;
    dashboard = {
      id,
      name: entry.name,
      description: null,
      config: entry.config,
      visibility: "everyone",
      createdByUserId: null,
      createdBy: null,
      creatorRemoved: false,
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
    };
    view = { kind: "series", series: entry.series, coverage: entry.coverage };
  } else {
    const { digests, names, tags, governance } = page.value;
    missingRepo = page.value.missingRepo;
    dashboard = page.value.dashboard;
    const metricOverride: DashboardMetric =
      metricParam === "share" || metricParam === "count" ? metricParam : dashboard.config.metric;
    dashboard = { ...dashboard, config: { ...dashboard.config, metric: metricOverride } };
    const asOf = new Date().toISOString();
    view = renderDashboard(dashboard.config, digests, tags, asOf, governance, names);
    paths = componentDisambiguators(dashboard.config.cohorts, [...digests, ...names]);
    if (dashboard.config.chartType === "trend" && view.kind === "series") {
      change = cohortChange(dashboard.config, view.series, digests, tags, governance, asOf);
    }
  }
  const notice = derivedEntry ? await chartResultsNotice(getPool(), true) : null;
  const config = dashboard.config;
  const metric = config.metric;
  const skipped = page.value.kind === "saved" ? chartSkippedNotices(config, page) : { fallbacks: [], gaps: [] };

  const derived = governancePage;
  const canEdit = can(identity, "edit");
  const canChange = !derived && can(identity, "edit", { chart: dashboard });
  const showMetricToggle = !governancePage && config.chartType !== "stacked-share";
  const title = derivedEntry
    ? `${derivedEntry.kind === "migration" ? "Migration" : "Retirement"}: ${derivedEntry.fromLabel}${derivedEntry.toLabel ? ` → ${derivedEntry.toLabel}` : ""}`
    : dashboard.name;

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/charts" className="transition-colors hover:text-foreground">
          Charts
        </Link>
        <span aria-hidden>/</span>
        <span className="max-w-[24rem] truncate">{dashboard.name}</span>
      </div>

      <ChartExportProvider title={title}>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-headline sm:text-2xl">
              {derivedEntry ? (
                <>
                  {derivedEntry.kind === "migration" ? "Migration: " : "Retirement: "}
                  <span className="font-mono tracking-normal"><ChartTitleLabel text={derivedEntry.fromLabel} /></span>
                  {derivedEntry.toLabel ? (
                    <>
                      <span className="sr-only"> replaced by </span>
                      <span aria-hidden className="text-muted-foreground">
                        {" → "}
                      </span>
                      <span className="font-mono tracking-normal"><ChartTitleLabel text={derivedEntry.toLabel} /></span>
                    </>
                  ) : null}
                </>
              ) : (
                dashboard.name
              )}
            </h1>
            {derivedEntry ? (
              <div className="mt-1">
                <TrackingReadout entry={derivedEntry} />
              </div>
            ) : null}
            {dashboard.description ? (
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">{dashboard.description}</p>
            ) : null}
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{CHART_KIND_LABEL[config.chartType]}</span>
              <DashboardScopeBadge scope={config.scope} missing={missingRepo?.missing} />
              {dashboard.createdBy ? <span>Created by {dashboard.createdBy}</span> : null}
              {derived ? null : (
                <ChartVisibilityLabel
                  visibility={dashboard.visibility}
                  mine={identity?.kind === "person" && identity.userId === dashboard.createdByUserId}
                />
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {showMetricToggle ? <DashboardMetricToggle metric={metric} /> : null}
            {canChange ? (
              <>
                <Link href={`/charts/${encodeURIComponent(dashboard.id)}/edit`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  Edit
                </Link>
                <DeleteDashboardButton id={dashboard.id} />
              </>
            ) : null}
            <ChartMenu
              id={dashboard.id}
              canDuplicate={!derived && canEdit}
              visibility={canChange ? dashboard.visibility : null}
              exportSubmenu={!derived}
            />
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
            description={
              canChange
                ? `There are no scans for ${missingRepo.repoId} any more. It may have been renamed or deleted. Edit the chart to pick another repo, or delete it.`
                : `There are no scans for ${missingRepo.repoId} any more. It may have been renamed or deleted.`
            }
          />
        ) : derivedEntry?.coverage.total === 0 ? (
          <EmptyState
            icon={<SearchX className="size-6" />}
            title={`No scan has found a use of ${derivedEntry.fromLabel}, so there's nothing to migrate.`}
            description="To count a repo that used it before its first scan, upload scans of that repo's older commits."
          />
        ) : isEmptyView(view) ? (
          <EmptyState
            icon={<SearchX className="size-6" />}
            title="Couldn't find the components in this chart."
            description={canChange ? "Edit the chart to pick them again." : undefined}
          />
        ) : (
          /* A table runs flush to the panel edge; plotted charts sit inset. */
          <div className={config.chartType === "table" ? "panel overflow-hidden" : "panel p-4"}>
            <LinkedDashboardChart config={config} view={view} range={rangeParam ?? config.range ?? "all"} change={change} paths={paths} />
          </div>
        )}
      </ChartExportProvider>

      {derivedEntry && canEdit ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {derivedEntry.recordIds.length === 1
            ? "Created from a Governance record."
            : `Created from ${derivedEntry.recordIds.length.toLocaleString()} Governance records.`}{" "}
          <Link href={`/governance#record-${derivedEntry.record.id}`} className="underline underline-offset-2 transition-colors hover:text-foreground">
            Manage records
          </Link>{" "}
          in Governance.
        </p>
      ) : null}
    </div>
  );
}
