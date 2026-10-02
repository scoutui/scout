import type { ScanStats } from "../artifact/scan-stats.js";
import { nuxtAppUnprepared } from "../scan/global-components.js";
import { declaredDependenciesInstalled } from "../workspace/declared-deps.js";
import type { WorkspaceGraph } from "../workspace/types.js";

const DEPENDENCIES_NOT_INSTALLED =
  "Couldn't upload the scan: some dependencies aren't installed. Install them and try again.";

/**
 * Why an upload must stop before scanning, or null when it may scan:
 * a package that the workspace root's `package.json`, or that of a member
 * owning one of `files`, lists in `dependencies` or `devDependencies` is not
 * installed; else the scan root declares `nuxt` and the app hasn't been
 * prepared.
 */
export function setupRefusal(graph: WorkspaceGraph, files: readonly string[], scanRoot: string): string | null {
  if (!declaredDependenciesInstalled(graph, files)) return DEPENDENCIES_NOT_INSTALLED;
  if (nuxtAppUnprepared(scanRoot)) {
    return "Couldn't upload the scan: this Nuxt app hasn't been prepared. Run npx nuxt prepare and try again.";
  }
  return null;
}

/** Why an upload must not upload what the scan found, or null when it may: the scan found no components. */
export function emptyScanRefusal(stats: ScanStats, paths: { configPath: string }): string | null {
  if (stats.occurrenceCount > 0) return null;
  return `Couldn't upload the scan: no components were found. Check "include" in ${paths.configPath} and try again.`;
}
