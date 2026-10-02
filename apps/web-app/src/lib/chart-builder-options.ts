import { libraryTags, type StorageDriver } from "@scoutui/web-shared";
import type { PickableComponent } from "@/components/dashboards/series-picker";

export type ChartBuilderOptions = {
  libraryTags: Array<{ id: string; label: string; color: string }>;
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
    libraryTags: libraryTags(tags).map((t) => ({ id: t.id, label: t.value, color: t.color })),
    repos: repos.map((r) => r.repoId).sort((a, b) => a.localeCompare(b)),
    components: componentList.map((c) => ({
      componentId: c.componentId,
      displayName: c.displayName,
      packageName: c.packageName,
    })),
    packages: packageList.map((p) => p.packageName).sort((a, b) => a.localeCompare(b)),
  };
}
