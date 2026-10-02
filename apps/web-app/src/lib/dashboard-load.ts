import { isSeriesChart, renderDashboard, type DashboardConfig, type DashboardView, type DigestScan, type StorageDriver } from "@scoutui/web-shared";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";
import type { ReadModelResult, SkippedNotices } from "@/lib/read-model-state";

export type { DashboardView };

/**
 * The scan digests a chart reads. Trend, stacked and table charts read every scan in scope.
 * A bars chart reads the latest scan per repo, and `names` holds, from every scan in scope,
 * the digests of the component cohorts those latest scans don't hold, to name them.
 */
export async function loadChartDigests(snapshot: StorageDriver, config: DashboardConfig): Promise<{ digests: DigestScan[]; names: DigestScan[] }> {
  const repoId = config.scope.kind === "repo" ? config.scope.repoId : undefined;
  if (isSeriesChart(config)) return { digests: await snapshot.listScanDigests(repoId), names: [] };
  const digests = await snapshot.listScanDigests(repoId, { latestOnly: true });
  const held = new Set(digests.flatMap(scan => scan.components.map(c => c.id)));
  const componentIds = config.cohorts.flatMap(c => (c.kind === "component" && !held.has(c.componentId) ? [c.componentId] : []));
  const names = componentIds.length ? await snapshot.listScanDigests(repoId, { componentIds }) : [];
  return { digests, names };
}

/** What a chart says about the scans it couldn't read: a trend's left-out scans, or a bars chart's repos at an older scan. */
export function chartSkippedNotices(config: DashboardConfig, notices: SkippedNotices): SkippedNotices {
  return isSeriesChart(config) ? { fallbacks: [], gaps: notices.gaps } : { fallbacks: notices.fallbacks, gaps: [] };
}

/** Async: load in-scope scan digests + tags from storage, then render. Uses getStorage() (server-side). */
export async function loadDashboardView(config: DashboardConfig): Promise<ReadModelResult<DashboardView>> {
  const result = await readModelPage(getStorage(), async snapshot => ({
    ...(await loadChartDigests(snapshot, config)),
    tags: await snapshot.listTags(),
    governance: await snapshot.listGovernance(),
  }));
  if (result.state !== "ready") return result;
  const { digests, names, tags, governance } = result.value;
  return { state: "ready", value: renderDashboard(config, digests, tags, governance, names), ...chartSkippedNotices(config, result) };
}
