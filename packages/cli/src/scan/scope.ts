import { relative } from "node:path";
import { posixPath } from "@scoutui/reference-graph";
import type { ScanScope } from "@scoutui/scan-format";
import type { ResolvedConfig } from "../types.js";
import { findPackageOrRoot, type WorkspaceGraph } from "../workspace/index.js";

/** What the scan covers: the config's folder, include and exclude, and each package holding one of `files`, sorted by folder. Folders are relative to `outputRoot`. */
export function buildScanScope(input: {
  cfg: ResolvedConfig;
  outputRoot: string;
  workspaceGraph: WorkspaceGraph;
  files: readonly string[];
}): ScanScope {
  const { cfg, outputRoot, workspaceGraph, files } = input;
  const packages = new Map<string, { name: string; folder: string }>();
  for (const file of files) {
    const pkg = findPackageOrRoot(workspaceGraph, file);
    if (pkg !== null && !packages.has(pkg.name)) {
      packages.set(pkg.name, { name: pkg.name, folder: posixPath(relative(outputRoot, pkg.absolutePath)) });
    }
  }
  return {
    folder: posixPath(relative(outputRoot, cfg.configDir)),
    ...(cfg.include !== undefined ? { include: cfg.include } : {}),
    exclude: cfg.exclude,
    packages: [...packages.values()].sort((a, b) => (a.folder < b.folder ? -1 : 1)),
  };
}
