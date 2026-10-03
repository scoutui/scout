/**
 * Per-workspace-package tsconfig alias layers. Each member's
 * own tsconfig(.base).json contributes an AliasEntry[] and its `baseUrl`
 * directory, applied only to files that member owns, so two apps that both
 * define `@/*` don't collide.
 * Discovery per member reuses resolveTsconfigPath with configDir = repoRoot =
 * the member dir (no walk-up per member; the root layer covers inheritance).
 */
import { realpathSync } from "node:fs";
import type { WorkspaceGraph } from "../workspace/types.js";
import { resolveTsconfigPath } from "./tsconfig-discovery.js";
import { loadTsconfigChain, type AliasEntry } from "./tsconfig-loader.js";

export type PackageAliasLayer = { pkgRealPath: string; entries: AliasEntry[]; baseUrlDir: string | undefined };

/** The alias layers of the members whose tsconfig declares aliases or `baseUrl`, and how many members have a tsconfig at all. */
export function buildPackageAliasLayers(
  graph: WorkspaceGraph,
  onWarning?: (message: string) => void,
): { layers: PackageAliasLayer[]; tsconfigCount: number } {
  const layers: PackageAliasLayer[] = [];
  let tsconfigCount = 0;
  for (const pkg of graph.packages) {
    const tsconfigPath = resolveTsconfigPath({
      configDir: pkg.absolutePath,
      repoRoot: pkg.absolutePath,
    });
    if (!tsconfigPath) continue;
    tsconfigCount += 1;
    const { entries, baseUrlDir, warnings } = loadTsconfigChain(tsconfigPath, graph.rootPath);
    if (onWarning) for (const w of warnings) onWarning(w);
    if (entries.length === 0 && baseUrlDir === undefined) continue;
    layers.push({ pkgRealPath: safeRealpath(pkg.absolutePath), entries, baseUrlDir });
  }
  // Longest path first → nested packages beat their ancestors.
  layers.sort((a, b) => b.pkgRealPath.length - a.pkgRealPath.length);
  return { layers, tsconfigCount };
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
