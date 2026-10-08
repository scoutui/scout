import { libraryTags, type StorageDriver } from "@scoutui/web-shared";
import type { LibraryTag, PickableComponent } from "@/lib/chart-builder-series";

export type ChartBuilderOptions = {
  libraryTags: LibraryTag[];
  repos: string[];
  components: PickableComponent[];
  packages: string[];
};

export type PickableSeries = { components: PickableComponent[]; packages: string[] };

/** The chart builder's scope and series lists, read from one snapshot. */
export async function chartBuilderOptions(snapshot: StorageDriver): Promise<ChartBuilderOptions> {
  const tags = await snapshot.listTags();
  const repos = await snapshot.listRepos();
  return {
    libraryTags: libraryTags(tags).map((t) => ({ id: t.id, label: t.value, color: t.color, rule: t.rule })),
    repos: repos.map((r) => r.repoId).sort((a, b) => a.localeCompare(b)),
    ...(await pickableSeries(snapshot)),
  };
}

/** The components and packages that one repo's scans, or every repo's, hold, with a package only older scans hold. */
export async function pickableSeries(snapshot: StorageDriver, repoId?: string): Promise<PickableSeries> {
  const componentList = await snapshot.listScannedComponents(repoId);
  const packageList = await snapshot.listPackages(repoId);
  const packages = new Set(packageList.map((p) => p.packageName));
  for (const c of componentList) if (c.lastSeenAt !== null && c.packageName !== null) packages.add(c.packageName);
  return {
    components: componentList.map((c) => ({
      componentId: c.componentId,
      displayName: c.displayName,
      packageName: c.packageName,
      disambiguator: c.disambiguator,
      deprecated: c.deprecated,
      occurrences: c.totalOccurrences,
      local: c.scope === "local",
      lastSeenAt: c.lastSeenAt,
    })),
    packages: [...packages].sort((a, b) => a.localeCompare(b)),
  };
}
