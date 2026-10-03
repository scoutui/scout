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

export function buildPackageAliasLayers(
  graph: WorkspaceGraph,
  onWarning?: (message: string) => void,
): PackageAliasLayer[] {
  const layers: PackageAliasLayer[] = [];
  const warned = new Set<string>();
  for (const pkg of graph.packages) {
    const tsconfigPath = resolveTsconfigPath({
      configDir: pkg.absolutePath,
      repoRoot: pkg.absolutePath,
    });
    if (!tsconfigPath) continue;
    const { entries, baseUrlDir, warnings } = loadTsconfigChain(tsconfigPath, graph.rootPath);
    for (const w of warnings) {
      if (warned.has(w)) continue;
      warned.add(w);
      onWarning?.(w);
    }
    if (entries.length === 0 && baseUrlDir === undefined) continue;
    layers.push({ pkgRealPath: safeRealpath(pkg.absolutePath), entries, baseUrlDir });
  }
  // Longest path first → nested packages beat their ancestors.
  layers.sort((a, b) => b.pkgRealPath.length - a.pkgRealPath.length);
  return layers;
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
