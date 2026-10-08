import type { Dashboard, GovernanceRecord, Tag } from "./dto.js";
import type { DigestScan } from "./digest.js";
import { type DashboardView, renderDashboard } from "./dashboard-render.js";
import { type GovernanceTracking, deriveGovernanceTracking } from "./governance-tracking.js";
import { type RegistryStats, deriveRecordStats } from "./governance-registry.js";
import { type GovernanceTarget, listGovernanceTargets } from "./governance.js";

export const CHART_RESULTS_VERSION = 17;
export const CHART_RESULTS_FORMAT_VERSION = 11;

export type DashboardPreview = { view: DashboardView; missing: boolean };
/** A stored preview, and when the snapshot it was derived from was read. */
export type StoredPreview = DashboardPreview & { snapshotAt: string };
export type RegistryResult = RegistryStats & { sources: GovernanceTarget[] };
/** The stored registry, and when the snapshot it was derived from was read. */
export type StoredRegistry = RegistryResult & { snapshotAt: string };
/** `asOf` ends the window the tracking's and tables' change is measured over. */
export type ChartResultsInput = { digests: DigestScan[]; tags: Tag[]; governance: GovernanceRecord[]; dashboards: Dashboard[]; asOf: string };
export type ChartResults = {
  tracking: GovernanceTracking[];
  repoTracking: Record<string, GovernanceTracking[]>;
  registry: RegistryResult;
  previews: Record<string, DashboardPreview>;
};

export const chartResultKey = {
  tracking: "tracking",
  registry: "registry",
  repoTracking: (repoId: string): string => `tracking:repo:${repoId}`,
  preview: (dashboardId: string): string => `preview:${dashboardId}`,
} as const;

/**
 * Every derivation below receives the same `digests` array, so the tracking that
 * `deriveRecordStats` runs internally is served from the tracking memo instead of
 * being computed twice, unless records share a replacement.
 */
export function deriveChartResults({ digests, tags, governance, dashboards, asOf }: ChartResultsInput): ChartResults {
  const tracking = deriveGovernanceTracking(governance, digests, { kind: "all" }, asOf);
  const repoTracking = Object.fromEntries(
    [...new Set(digests.map((d) => d.meta.repo.id))].map((repoId) => [
      repoId,
      deriveGovernanceTracking(governance, digests, { kind: "repo", repoId }, asOf),
    ]),
  );
  const registry = { ...deriveRecordStats(governance, digests, asOf), sources: listGovernanceTargets(digests) };
  const previews = Object.fromEntries(
    dashboards.map((dashboard) => {
      const scope = dashboard.config.scope;
      const scoped = scope.kind === "repo" ? digests.filter((d) => d.meta.repo.id === scope.repoId) : digests;
      const preview: DashboardPreview = {
        view: renderDashboard(dashboard.config, scoped, tags, asOf, governance),
        missing: scope.kind === "repo" && scoped.length === 0,
      };
      return [dashboard.id, preview];
    }),
  );
  return { tracking, repoTracking, registry, previews };
}

/**
 * Queues a results job inside the caller's transaction, or row-locks the one already queued so no worker
 * claims it until that transaction ends. Resolves true when a row was inserted or locked.
 */
export async function enqueueChartResults(db: { query(text: string, values?: unknown[]): Promise<{ rowCount: number | null }> }): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO scan_jobs (id, kind, projection_version, priority) VALUES (gen_random_uuid()::text, 'results', $1, 0)
     ON CONFLICT (kind) WHERE kind = 'results' AND state = 'queued' DO UPDATE SET updated_at = now()`,
    [CHART_RESULTS_VERSION],
  );
  return result.rowCount === 1;
}

export function chartResultRows(results: ChartResults): Array<{ key: string; payload: unknown }> {
  return [
    { key: chartResultKey.tracking, payload: results.tracking },
    { key: chartResultKey.registry, payload: results.registry },
    ...Object.entries(results.repoTracking).map(([repoId, payload]) => ({ key: chartResultKey.repoTracking(repoId), payload })),
    ...Object.entries(results.previews).map(([dashboardId, payload]) => ({ key: chartResultKey.preview(dashboardId), payload })),
  ];
}
