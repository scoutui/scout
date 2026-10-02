import { libraryTags, type StorageDriver } from "@scoutui/web-shared";
import type { PickableComponent } from "@/components/dashboards/series-picker";
import type { LibraryTag } from "@/lib/chart-builder-series";

export type ChartBuilderOptions = {
  libraryTags: LibraryTag[];
  repos: string[];
  components: PickableComponent[];
  packages: string[];
};

/** The chart builder's scope and series lists, read from one snapshot. */
export async function chartBuilderOptions(snapshot: StorageDriver): Promise<ChartBuilderOptions> {
  const tags = await snapshot.listTags();
  const repos = await snapshot.listRepos();
  const componentList = await snapshot.listComponents();
  const packageList = await snapshot.listPackages();
  return {
    libraryTags: libraryTags(tags).map((t) => ({ id: t.id, label: t.value, color: t.color, rule: t.rule })),
    repos: repos.map((r) => r.repoId).sort((a, b) => a.localeCompare(b)),
    components: componentList.map((c) => ({
      componentId: c.componentId,
      displayName: c.displayName,
      packageName: c.packageName,
      deprecated: c.deprecated,
    })),
    packages: packageList.map((p) => p.packageName).sort((a, b) => a.localeCompare(b)),
  };
}
