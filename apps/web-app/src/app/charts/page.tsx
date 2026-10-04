import Link from "next/link";
import { type Dashboard, type DashboardView, unknownCohortKeys } from "@scoutui/web-shared";
import { Milestone } from "lucide-react";
import { getPool } from "@/db/client";
import { getStorage } from "@/lib/storage";
import { chartResultsNotice } from "@/lib/read-model-progress";
import { ChartResultsState } from "@/components/read-model-state";
import { relativeTime } from "@/lib/relative-time";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DashboardSparkline } from "@/components/dashboards/dashboard-sparkline";
import { DashboardScopeBadge, UnknownComponentsBadge } from "@/components/dashboards/dashboard-scope-badge";
import { TrackingSection } from "@/components/dashboards/tracking-rows";
import { CHART_KIND_LABEL } from "@/lib/dashboard-format";
import { can } from "@/lib/access";
import { identify } from "@/lib/identity";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Charts" };

export default async function DashboardsPage() {
  const { all, governance, tracking, previews, latestScan, repoIds } = await getStorage().withReadSnapshot(async snapshot => ({
    all: await snapshot.listDashboards(),
    governance: await snapshot.listGovernance(),
    tracking: await snapshot.getStoredTracking({ kind: "all" }),
    previews: await snapshot.getStoredPreviews(),
    latestScan: await snapshot.latestScanArrivedAt(),
    repoIds: await snapshot.listRepoIds(),
  }));
  const identity = await identify({ browser: true });
  const canEdit = can(identity, "edit");
  const listed = all.filter((dashboard) => can(identity, "view", { chart: dashboard }));
  const notice =
    governance.length > 0 || listed.length > 0 ? await chartResultsNotice(getPool(), tracking !== null) : null;

  // Completed records move to a collapsed ledger in each section.
  const migrations = (tracking ?? []).filter((t) => t.kind === "migration");
  const retirements = (tracking ?? []).filter((t) => t.kind === "retirement");

  const rows = listed.map((dashboard) => {
    const scope = dashboard.config.scope;
    const preview = previews[dashboard.id];
    const missing = preview?.missing && scope.kind === "repo"
      ? repoIds.includes(scope.repoId) ? "scans" as const : "repo" as const
      : undefined;
    // A preview stored before the chart's last save was drawn from its old series.
    const unknown = preview !== undefined && !preview.missing && preview.snapshotAt >= dashboard.updatedAt
      && unknownCohortKeys(dashboard.config.cohorts, preview.view).size > 0;
    return { dashboard, missing, unknown, view: preview?.view ?? null };
  });
  const userId = identity?.kind === "person" ? identity.userId : null;
  const shared = rows.filter((row) => row.dashboard.visibility === "everyone");
  const mine = rows.filter((row) => row.dashboard.visibility === "private" && row.dashboard.createdByUserId === userId);
  const others = rows.filter((row) => row.dashboard.visibility === "private" && row.dashboard.createdByUserId !== userId);

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-display">Charts</h1>
          <p className="mt-1 text-sm tabular-nums text-muted-foreground">
            {listed.length.toLocaleString()} {listed.length === 1 ? "chart" : "charts"}
            {latestScan ? ` · latest scan ${relativeTime(latestScan)}` : ""}
          </p>
        </div>
        {canEdit ? (
          <Link href="/charts/new" className={cn(buttonVariants({ size: "sm" }))}>
            New chart
          </Link>
        ) : null}
      </div>

      {notice ? (
        <div className="mb-6">
          <ChartResultsState notice={notice} besideNumbers={tracking !== null || rows.some(row => row.view !== null)} />
        </div>
      ) : null}

      {/* Only a page with no governance records gets an empty state, as on the
          repo adoption tab. */}
      {governance.length === 0 ? (
        <EmptyState
          className="mb-6"
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
          {tracking ? (
            <>
              <TrackingSection
                kind="migration"
                entries={migrations.filter((t) => t.active)}
                complete={migrations.filter((t) => !t.active)}
                surface="estate"
              />
              <TrackingSection
                kind="retirement"
                entries={retirements.filter((t) => t.active)}
                complete={retirements.filter((t) => !t.active)}
                surface="estate"
              />
            </>
          ) : null}
        </>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No charts yet"
          description={canEdit ? "Compare libraries, packages or components across scans." : undefined}
          action={
            canEdit ? (
              <Link href="/charts/new" className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
                New chart
              </Link>
            ) : undefined
          }
        />
      ) : (
        /* Headed, because these rows look like the tracking rows above. */
        <>
          {chartSection("Shared charts", shared, false)}
          {chartSection("Private", mine, false)}
          {chartSection("Other people's charts", others, true)}
        </>
      )}
    </div>
  );
}

type ChartRow = { dashboard: Dashboard; missing: "scans" | "repo" | undefined; unknown: boolean; view: DashboardView | null };

/** A headed list of saved charts, or nothing when `rows` is empty. */
function chartSection(heading: string, rows: ChartRow[], showCreator: boolean) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-6 last:mb-0">
      <h2 className="mb-2 text-sm tabular-nums text-muted-foreground">
        {heading} · {rows.length.toLocaleString()}
      </h2>
      <div className="panel divide-y divide-border overflow-hidden">
        {rows.map(({ dashboard, missing, unknown, view }) => (
          <Link
            key={dashboard.id}
            href={`/charts/${encodeURIComponent(dashboard.id)}`}
            className="flex items-center gap-4 px-4 py-2.5 transition-colors hover:bg-secondary dark:hover:bg-accent"
          >
            <div className="min-w-0 flex-1">
              <span className="block truncate font-medium">{dashboard.name}</span>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{CHART_KIND_LABEL[dashboard.config.chartType]}</span>
                <DashboardScopeBadge scope={dashboard.config.scope} missing={missing} />
                {unknown ? <UnknownComponentsBadge /> : null}
                {showCreator && dashboard.createdBy ? <span>Created by {dashboard.createdBy}</span> : null}
              </div>
            </div>
            {/* Hidden on phones: 112px of preview is not worth the name's width. */}
            <span className="hidden sm:block">
              <DashboardSparkline uid={dashboard.id} config={dashboard.config} view={view} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
