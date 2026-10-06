/**
 * Build a workspace graph from a repository root.
 *
 * Two independent steps:
 *   - sniffPackageManager: lockfile-based; sets graph.packageManager. Always
 *     runs; returns "unknown" when no lockfile is found.
 *   - detectWorkspacePackages: pnpm-workspace.yaml → package.json#workspaces →
 *     empty array. Independent of step 1.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { globbySync } from "globby";
import * as yaml from "js-yaml";
import type { PackageManager, WorkspaceGraph, WorkspacePackage } from "./types.js";

export function buildWorkspaceGraph(rootPath: string, repoName: string): WorkspaceGraph {
  const absRoot = resolve(rootPath);
  const rootPkgJsonPath = join(absRoot, "package.json");
  const rootPkg = readJsonSafely(rootPkgJsonPath) ?? {};
  const rootPackageName: string =
    typeof rootPkg.name === "string" && rootPkg.name.length > 0 ? rootPkg.name : repoName;

  return {
    packageManager: sniffPackageManager(absRoot),
    rootPath: absRoot,
    rootPackageName,
    packages: detectWorkspacePackages(absRoot, rootPkg),
  };
}

function sniffPackageManager(absRoot: string): PackageManager {
  if (existsSync(join(absRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(absRoot, "package-lock.json"))) return "npm";
  if (existsSync(join(absRoot, "yarn.lock"))) return "yarn";
  return "unknown";
}

/**
 * Loosened input for `detectWorkspacePackages`: only the `workspaces` field
 * is typed, plus an index signature so callers can pass any freshly-parsed,
 * unvalidated `package.json` (e.g. `findWorkspaceRoot` walking arbitrary
 * ancestor directories) without casting at the call site.
 */
export type DetectWorkspacePackagesInput = Record<string, unknown> & {
  workspaces?: WorkspacePackage["packageJson"]["workspaces"];
};

/**
 * pnpm-workspace.yaml → package.json#workspaces → empty array.
 */
export function detectWorkspacePackages(
  absRoot: string,
  rootPkg: DetectWorkspacePackagesInput,
): WorkspacePackage[] {
  // pnpm-workspace.yaml wins when both configs present.
  const pnpmYamlPath = join(absRoot, "pnpm-workspace.yaml");
  if (existsSync(pnpmYamlPath)) {
    const yamlContent = readFileSync(pnpmYamlPath, "utf8");
    let parsed: unknown;
    try {
      parsed = yaml.load(yamlContent);
    } catch {
      parsed = null;
    }
    const globs = isWorkspaceYaml(parsed) ? parsed.packages : [];
    return expandPackages(absRoot, globs);
  }

  // package.json#workspaces (array or object form).
  const workspaces = rootPkg.workspaces;
  if (Array.isArray(workspaces)) {
    return expandPackages(absRoot, workspaces);
  }
  if (
    workspaces &&
    typeof workspaces === "object" &&
    Array.isArray((workspaces as { packages?: unknown }).packages)
  ) {
    return expandPackages(absRoot, (workspaces as { packages: string[] }).packages);
  }

  // No workspace config → single-package repo.
  return [];
}

function expandPackages(absRoot: string, entries: string[]): WorkspacePackage[] {
  if (entries.length === 0) return [];
  // Split literal paths from globs: globby (fast-glob) treats a bare "foo"
  // as "foo/**" and returns subdirectories instead of foo itself, so literal
  // workspace entries must be resolved directly.
  const literals: string[] = [];
  const globs: string[] = [];
  for (const e of entries) {
    if (/[*?[\]{}]/.test(e)) globs.push(e);
    else literals.push(e);
  }
  const matched: string[] = literals.map((p) => resolve(absRoot, p));
  if (globs.length > 0) {
    matched.push(
      ...globbySync(globs, {
        cwd: absRoot,
        onlyDirectories: true,
        absolute: true,
        suppressErrors: true,
        // Package managers never take an installed package as a workspace
        // member, so a `packages/**` glob must not reach into node_modules.
        ignore: ["**/node_modules/**"],
      }),
    );
  }
  const packages: WorkspacePackage[] = [];
  const seenNames = new Set<string>();
  for (const dir of matched) {
    const pkgJson = readJsonSafely(join(dir, "package.json"));
    if (!pkgJson) continue;
    if (typeof pkgJson.name !== "string" || pkgJson.name.length === 0) continue;
    if (seenNames.has(pkgJson.name)) continue;
    seenNames.add(pkgJson.name);
    packages.push({ name: pkgJson.name, absolutePath: dir, packageJson: pkgJson });
  }
  return packages;
}

export function readJsonSafely(path: string): WorkspacePackage["packageJson"] | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isWorkspaceYaml(p: unknown): p is { packages: string[] } {
  return (
    typeof p === "object" &&
    p !== null &&
    Array.isArray((p as { packages?: unknown }).packages)
  );
}
