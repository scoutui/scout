import type { ScanStats } from "../artifact/scan-stats.js";
import { nuxtAppUnprepared } from "../scan/global-components.js";
import { declaredInPath, missingDependency } from "../workspace/declared-deps.js";
import type { WorkspaceGraph } from "../workspace/types.js";

/** What stops an upload before scanning, as `setupProblem` finds it. */
export type SetupProblem =
  | { kind: "dependencies-missing"; packageName: string; declaredIn: string }
  | { kind: "nuxt-unprepared" };

/** Why an upload must stop before scanning, as the line it prints, or null when it may scan. See `setupProblem`. */
export function setupRefusal(graph: WorkspaceGraph, files: readonly string[], scanRoot: string, outputRoot: string): string | null {
  const problem = setupProblem(graph, files, scanRoot, outputRoot);
  if (problem?.kind === "dependencies-missing") {
    return `Couldn't upload the scan: ${problem.packageName} is listed in ${problem.declaredIn} but isn't installed. Install your dependencies and try again.`;
  }
  if (problem?.kind === "nuxt-unprepared") {
    return "Couldn't upload the scan: this Nuxt app hasn't been prepared. Run npx nuxt prepare and try again.";
  }
  return null;
}

/**
 * What stops an upload before scanning: `dependencies-missing`, naming the package and the `package.json` that lists
 * it (`declaredInPath`), when a package that the workspace root's `package.json`, or that of a member owning one of
 * `files`, lists in `dependencies` or `devDependencies` isn't installed; else `nuxt-unprepared` when the scan root declares
 * `nuxt` and the app hasn't been prepared; null when neither.
 */
export function setupProblem(
  graph: WorkspaceGraph,
  files: readonly string[],
  scanRoot: string,
  outputRoot: string,
): SetupProblem | null {
  const missing = missingDependency(graph, files);
  if (missing !== null) {
    return { kind: "dependencies-missing", packageName: missing.packageName, declaredIn: declaredInPath(outputRoot, missing.manifest) };
  }
  if (nuxtAppUnprepared(scanRoot)) return { kind: "nuxt-unprepared" };
  return null;
}

/**
 * Why an upload must not upload what the scan found, or null when it may: the scan found no components. It names
 * `include`, or `exclude` when the config has no `include`.
 */
export function emptyScanRefusal(stats: ScanStats, paths: { configPath: string; include?: readonly string[] }): string | null {
  if (stats.occurrenceCount > 0) return null;
  const field = paths.include === undefined ? "exclude" : "include";
  return `Couldn't upload the scan: no components were found. Check "${field}" in ${paths.configPath} and try again.`;
}
