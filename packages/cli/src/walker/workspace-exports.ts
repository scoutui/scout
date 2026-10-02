import type { AliasEntry } from "./tsconfig-loader.js";
import { compileAliasPattern } from "./tsconfig-loader.js";
import type { WorkspaceGraph, WorkspacePackage } from "../workspace/types.js";

// Resolver entries that resolve any import of a workspace member's name to its
// source on disk, whether or not it is installed (no symlink needed), and ahead
// of a published copy in node_modules (this layer precedes Node resolution).
// Per member, in precedence order:
//
//   1. Declared `exports` subpaths:
//      - Constant: "./types" -> "./types.ts"  matches <pkgName>/types exactly.
//      - Pattern:  "./icons/<star>" -> "./icons/<star>.tsx".
//      Skipped: conditional objects, null targets, multi-wildcard targets,
//      non-subpath keys. A `null` (deny) subpath is still reached by the
//      wildcard source probe below: this layer attributes usage to source, it
//      doesn't enforce publish-time encapsulation.
//   2. One bare-name entry: <pkgName> -> [exports["."], module, main, ".", "./src"].
//      The "." / "./src" directory targets rely on tryFileWithExtensions'
//      index probing. Conditional exports["."] contributes its first string
//      among import/module/default (one level deep).
//   3. One wildcard fallback: <pkgName>/<star> -> ./<star> (source-tree probe).
//
// Within a package, subpath entries sort by static-prefix length descending so
// more-specific subpaths beat patterns, as in Node's exports specificity rule;
// the bare-name and wildcard entries follow, so declared exports win when
// their targets exist on disk.
export function buildWorkspaceExportEntries(graph: WorkspaceGraph): AliasEntry[] {
  const out: AliasEntry[] = [];
  for (const pkg of graph.packages) {
    out.push(...subpathExportEntries(pkg));
    out.push(bareNameEntry(pkg));
    out.push({
      pattern: wildcardPattern(pkg.name),
      targets: ["./*"],
      base: pkg.absolutePath,
    });
  }
  return out;
}

function subpathExportEntries(pkg: WorkspacePackage): AliasEntry[] {
  const exports = pkg.packageJson.exports;
  if (exports === null || exports === undefined) return [];
  if (typeof exports !== "object") return [];
  if (Array.isArray(exports)) return [];

  const out: AliasEntry[] = [];
  const subpaths = Object.entries(exports as Record<string, unknown>)
    .filter(([key]) => key.startsWith("./") && key !== "./")
    .sort(([a], [b]) => staticPrefixLength(b) - staticPrefixLength(a));

  for (const [subpath, target] of subpaths) {
    if (target === null) continue;
    if (typeof target !== "string") continue;
    if (target.includes("**")) continue;
    if (target.split("*").length > 2) continue;

    // "./icons/*" + "@example/icons" → "@example/icons/icons/*"
    const fullPattern = `${pkg.name}${subpath.slice(1)}`;
    out.push({
      pattern: compileAliasPattern(fullPattern),
      targets: [target],
      base: pkg.absolutePath,
    });
  }
  return out;
}

function bareNameEntry(pkg: WorkspacePackage): AliasEntry {
  const targets: string[] = [];
  const dot = dotExportTarget(pkg.packageJson.exports);
  if (dot !== null) targets.push(dot);
  if (typeof pkg.packageJson.module === "string") targets.push(pkg.packageJson.module);
  if (typeof pkg.packageJson.main === "string") targets.push(pkg.packageJson.main);
  targets.push(".", "./src");
  return {
    pattern: compileAliasPattern(pkg.name),
    targets,
    base: pkg.absolutePath,
  };
}

// `<pkgName>/*` with `..` path segments rejected, so the source-tree probe
// cannot expand outside the member directory (`@ws/ui/../secret` falls through
// to Node resolution instead). `..` inside a segment name (`a..b`) stays legal.
// Reuses compileAliasPattern for the name's regex escaping; the name itself
// contains no `*`, so the compiled source is the escaped literal.
function wildcardPattern(pkgName: string): RegExp {
  const escapedName = compileAliasPattern(pkgName).source.slice(1, -1);
  return new RegExp(`^${escapedName}/((?!\\.\\.(?:/|$))(?:(?!/\\.\\.(?:/|$)).)*)$`);
}

// exports["."] as an entry-point target: string form, the bare-string sugar,
// or (one level deep) the first string among import/module/default in a
// conditional object. Anything else → null (bare-name entry falls through to
// module/main/directory probes).
function dotExportTarget(exports: unknown): string | null {
  if (typeof exports === "string") return exports;
  if (exports === null || typeof exports !== "object" || Array.isArray(exports)) return null;
  const dot = (exports as Record<string, unknown>)["."];
  if (typeof dot === "string") return dot;
  if (dot !== null && typeof dot === "object" && !Array.isArray(dot)) {
    for (const key of ["import", "module", "default"]) {
      const value = (dot as Record<string, unknown>)[key];
      if (typeof value === "string") return value;
    }
  }
  return null;
}

function staticPrefixLength(subpath: string): number {
  const starIdx = subpath.indexOf("*");
  return starIdx === -1 ? subpath.length : starIdx;
}
