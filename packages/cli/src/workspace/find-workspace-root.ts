/**
 * Walk up from scanRoot to the nearest ancestor that declares workspaces
 * (pnpm-workspace.yaml or package.json#workspaces) and whose expanded member
 * globs include scanRoot. Ownership and resolution anchor at the true
 * workspace root, independent of where the scan is pointed.
 *
 * The walk starts at dirname(scanRoot): a scanRoot that is itself a workspace
 * root needs no promotion (caller falls back to scanRoot).
 * Bounded by stopAt (inclusive; typically the git toplevel) and the fs root.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { detectWorkspacePackages, type DetectWorkspacePackagesInput } from "./build-graph.js";

export function findWorkspaceRoot(scanRoot: string, stopAt?: string): string | null {
  const absScan = safeRealpath(resolve(scanRoot));
  const stop = stopAt ? safeRealpath(resolve(stopAt)) : null;
  let dir = dirname(absScan);
  // stopAt below scanRoot's parent → nothing to walk.
  for (;;) {
    if (stop && !isPathPrefix(stop, dir)) return null;
    const pkgJsonPath = join(dir, "package.json");
    const hasPnpmYaml = existsSync(join(dir, "pnpm-workspace.yaml"));
    if (hasPnpmYaml || existsSync(pkgJsonPath)) {
      const rootPkg = readJsonSafely(pkgJsonPath) ?? {};
      const members = detectWorkspacePackages(dir, rootPkg);
      if (members.some((m) => safeRealpath(m.absolutePath) === absScan)) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readJsonSafely(p: string): DetectWorkspacePackagesInput | null {
  try {
    // JSON.parse returns `any`, which assigns to DetectWorkspacePackagesInput
    // without a cast.
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function isPathPrefix(prefix: string, candidate: string): boolean {
  if (candidate === prefix) return true;
  const withSep = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return candidate.startsWith(withSep);
}
