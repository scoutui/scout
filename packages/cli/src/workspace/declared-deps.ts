/**
 * Declared dependencies of the workspace root and its packages.
 * `createDeclaredDependencyTest` answers for one file;
 * `missingDependency` checks the install for a set of files.
 *
 * `createDeclaredDependencyTest` takes the root `package.json` read as a
 * parameter so tests can drive it without filesystem fixtures.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isInstalledPackage } from "../walker/installed-package.js";
import { findOwningPackage } from "./find-owning-package.js";
import type { WorkspaceGraph, WorkspacePackage } from "./types.js";

type PkgJson = WorkspacePackage["packageJson"];
type ReadPkgJson = (path: string) => PkgJson | null;

const defaultReader: ReadPkgJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/**
 * The absolute path of the `package.json` that declares `packageName`, in any
 * dependency field: the workspace root's, else that of the workspace member
 * that owns the absolute path `fromFile` (`findOwningPackage`). Null when
 * neither declares it.
 */
export function createDeclaredDependencyTest(
  graph: WorkspaceGraph,
  read: ReadPkgJson = defaultReader,
): (fromFile: string, packageName: string) => string | null {
  const rootManifest = join(graph.rootPath, "package.json");
  const root = new Set<string>();
  collect(read(rootManifest), root);
  const byMember = new Map<WorkspacePackage, Set<string>>();
  return (fromFile, packageName) => {
    if (root.has(packageName)) return rootManifest;
    const owner = findOwningPackage(graph, fromFile);
    if (owner === null) return null;
    let names = byMember.get(owner);
    if (names === undefined) {
      names = new Set();
      collect(owner.packageJson, names);
      byMember.set(owner, names);
    }
    return names.has(packageName) ? join(owner.absolutePath, "package.json") : null;
  };
}

/**
 * The first package listed in `dependencies` or `devDependencies` that isn't
 * installed where Node looks from the `package.json` that lists it
 * (`isInstalledPackage`), with the absolute path of that `package.json`, or
 * null when all are installed. The manifests read are the workspace root's and
 * those of the workspace members that own one of the absolute paths `files`
 * (`findOwningPackage`).
 */
export function missingDependency(
  graph: WorkspaceGraph,
  files: readonly string[],
): { packageName: string; manifest: string } | null {
  const rootManifest = join(graph.rootPath, "package.json");
  const fromRoot = firstMissing(rootManifest, defaultReader(rootManifest));
  if (fromRoot !== null) return fromRoot;
  const checked = new Set<WorkspacePackage>();
  for (const file of files) {
    const owner = findOwningPackage(graph, file);
    if (owner === null || checked.has(owner)) continue;
    checked.add(owner);
    const fromMember = firstMissing(join(owner.absolutePath, "package.json"), owner.packageJson);
    if (fromMember !== null) return fromMember;
  }
  return null;
}

/** The first package `pkg` lists in `dependencies` or `devDependencies` that isn't installed from `manifest`, or null. */
function firstMissing(manifest: string, pkg: PkgJson | null): { packageName: string; manifest: string } | null {
  if (!pkg) return null;
  for (const bucket of [pkg.dependencies, pkg.devDependencies]) {
    for (const packageName of Object.keys(bucket ?? {})) {
      if (!isInstalledPackage(manifest, packageName)) return { packageName, manifest };
    }
  }
  return null;
}


function collect(pkg: PkgJson | null, into: Set<string>): void {
  if (!pkg) return;
  for (const bucket of [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.peerDependencies,
    pkg.optionalDependencies,
  ]) {
    if (!bucket) continue;
    for (const name of Object.keys(bucket)) into.add(name);
  }
}
