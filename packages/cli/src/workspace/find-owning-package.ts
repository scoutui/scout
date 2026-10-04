/**
 * Realpath-aware workspace-membership check. Resolves the input path via
 * realpath so node_modules symlinks (yarn/pnpm's usual layout) match their
 * underlying workspace package directories.
 *
 * Returns the WorkspacePackage with the longest absolutePath that is a path
 * prefix of the resolved input. Null when no package owns the file.
 *
 * Realpath results are memoised per scan. Uncached, each call costs 1 + N
 * realpath syscalls (the input and every workspace package), the main cost
 * in large monorepos.
 */
import { realpathSync } from "node:fs";
import type { WorkspaceGraph, WorkspacePackage } from "./types.js";

const realpathCache = new Map<string, string>();

export function findOwningPackage(
  graph: WorkspaceGraph,
  filePath: string,
): WorkspacePackage | null {
  if (graph.packages.length === 0) return null;
  const resolved = resolveRealpath(filePath);
  let best: WorkspacePackage | null = null;
  let bestPrefixLen = -1;
  for (const pkg of graph.packages) {
    // Realpath the package root too: on macOS tmpdir resolves through
    // /var -> /private/var, and consumers may pass either form into the graph.
    const pkgPath = resolveRealpath(pkg.absolutePath);
    if (!isPathPrefix(pkgPath, resolved)) continue;
    // Reject paths that fall inside a node_modules under the workspace
    // package: those are vendor packages installed within the workspace
    // (e.g. <app>/node_modules/@vendor/foo), not the workspace's own source.
    // Symlinked sibling workspaces have already collapsed away via realpath.
    if (resolved.slice(pkgPath.length).includes("/node_modules/")) continue;
    if (pkgPath.length > bestPrefixLen) {
      best = pkg;
      bestPrefixLen = pkgPath.length;
    }
  }
  return best;
}

/**
 * True when the path is first-party: a workspace member's file, or the root
 * package's own source (under the realpathed workspace root with no
 * `node_modules` segment after it).
 */
export function isFirstPartyPath(graph: WorkspaceGraph, filePath: string): boolean {
  return findPackageOrRoot(graph, filePath) !== null;
}

/** The package `filePath` belongs to: the deepest workspace package holding it, else the root package when the file is the root's own source (under `graph.rootPath`, outside `node_modules`). Null otherwise. */
export function findPackageOrRoot(
  graph: WorkspaceGraph,
  filePath: string,
): { name: string; absolutePath: string } | null {
  const owner = findOwningPackage(graph, filePath);
  if (owner !== null) return owner;
  const resolved = resolveRealpath(filePath);
  const root = resolveRealpath(graph.rootPath);
  if (!isPathPrefix(root, resolved) || resolved.slice(root.length).includes("/node_modules/")) return null;
  return { name: graph.rootPackageName, absolutePath: graph.rootPath };
}

/**
 * Reset the realpath memoization cache. Call between scans (or in test
 * setup) when filesystem state may have changed. Within a single scan,
 * realpath results are stable and cache hits are correct.
 */
export function resetFindOwningPackageCache(): void {
  realpathCache.clear();
}

function resolveRealpath(filePath: string): string {
  const hit = realpathCache.get(filePath);
  if (hit !== undefined) return hit;
  let resolved: string;
  try {
    resolved = realpathSync(filePath);
  } catch {
    resolved = filePath;
  }
  realpathCache.set(filePath, resolved);
  return resolved;
}

function isPathPrefix(prefix: string, candidate: string): boolean {
  if (candidate === prefix) return true;
  const withSep = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return candidate.startsWith(withSep);
}
