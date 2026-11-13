/**
 * Where an installed package's type declarations live: the `.d.ts` a bare
 * import specifier's entry resolves to, and the `.d.ts` a relative import
 * inside a declaration file names.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const isRelativeSpecifier = (specifier: string): boolean => specifier.startsWith(".");

/** `./_x-chunk.js` (or `.mjs`/`.cjs`, `.ts`/`.mts`/`.cts`, or extensionless) -> its sibling `.d.ts`, trying `index.d.ts` for a directory. Null when neither exists. */
export function relativeDtsPath(fromFile: string, source: string): string | null {
  const base = resolve(dirname(fromFile), source).replace(/\.(m|c)?[jt]s$/, "");
  for (const candidate of [`${base}.d.ts`, join(base, "index.d.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * `fromDir`'s installed `specifier` entry typings file, or why there isn't
 * one: `"not-installed"` and `"no-types"` are ordinary (nothing to read),
 * `"unreadable"` is a real problem a user can act on.
 */
export type EntryResolution = { kind: "found"; entryPath: string } | { kind: "not-installed" } | { kind: "no-types" } | { kind: "unreadable"; reason: string };

export function resolvePackageEntry(fromDir: string, specifier: string): EntryResolution {
  const { packageName, subpath } = parseSpecifier(specifier);
  const pkgDir = findPackageDir(fromDir, packageName);
  if (pkgDir === null) return { kind: "not-installed" };
  return resolveEntryTypesPath(pkgDir, subpath);
}

/** A bare import specifier split into its package name (handling a `@scope/name` prefix) and subpath (`""` for the package root). */
function parseSpecifier(specifier: string): { packageName: string; subpath: string } {
  const segments = specifier.split("/");
  if (specifier.startsWith("@")) return { packageName: segments.slice(0, 2).join("/"), subpath: segments.slice(2).join("/") };
  return { packageName: segments[0] ?? specifier, subpath: segments.slice(1).join("/") };
}

/** `packageName`'s install directory, walking up from `fromDir` the way Node resolves `node_modules`. Null when it isn't installed anywhere on that path. */
function findPackageDir(fromDir: string, packageName: string): string | null {
  let dir = fromDir;
  while (true) {
    const candidate = join(dir, "node_modules", packageName);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The typings `subpath` resolves to in the package at `pkgDir`, as TypeScript
 * finds them: through `package.json#exports` when present; otherwise the root's
 * `types` (or `typings`), else the `.d.ts` beside its `main`; and a deeper
 * subpath's own `.d.ts` beside the file it names.
 */
function resolveEntryTypesPath(pkgDir: string, subpath: string): EntryResolution {
  let pkg: { exports?: unknown; types?: unknown; typings?: unknown; main?: unknown };
  try {
    pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  } catch {
    return { kind: "unreadable", reason: "its package.json is missing or isn't valid JSON" };
  }

  const key = subpath === "" ? "." : `./${subpath}`;
  let typesRel: string | undefined;
  if (pkg.exports !== undefined && pkg.exports !== null && typeof pkg.exports === "object" && !Array.isArray(pkg.exports)) {
    const exportsMap = pkg.exports as Record<string, unknown>;
    const target = exportsMap[key] ?? matchExportPattern(exportsMap, key);
    typesRel = typesFromTarget(target) ?? siblingTypesOf(pkgDir, codeFromTarget(target));
  } else if (subpath === "") {
    typesRel =
      typeof pkg.types === "string" ? pkg.types
      : typeof pkg.typings === "string" ? pkg.typings
      : siblingTypesOf(pkgDir, typeof pkg.main === "string" ? pkg.main : "index.js");
  } else {
    typesRel = siblingTypesOf(pkgDir, subpath);
  }

  // No `types` condition for this subpath at all: a plain JS library, or one
  // that simply doesn't publish typings for this entry. Ordinary, not a
  // problem to report.
  if (typesRel === undefined) return { kind: "no-types" };
  const entryPath = resolve(pkgDir, typesRel);
  if (!existsSync(entryPath)) return { kind: "unreadable", reason: `its declared types file "${typesRel}" doesn't exist` };
  return { kind: "found", entryPath };
}

/** A `"./icons/*": "./types/icons/*.d.ts"`-style pattern key of `exportsMap` matching `key`, substituted; undefined when none matches. */
function matchExportPattern(exportsMap: Record<string, unknown>, key: string): unknown {
  for (const [pattern, target] of Object.entries(exportsMap)) {
    const star = pattern.indexOf("*");
    if (star === -1) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (key.length >= prefix.length + suffix.length && key.startsWith(prefix) && key.endsWith(suffix)) {
      return substituteWildcard(target, key.slice(prefix.length, key.length - suffix.length));
    }
  }
  return undefined;
}

function substituteWildcard(value: unknown, wildcard: string): unknown {
  if (typeof value === "string") return value.replaceAll("*", wildcard);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteWildcard(v, wildcard);
    return out;
  }
  return value;
}

/** An `exports` subpath target's condition object, as far as `typesFromTarget` reads it. */
type ExportConditions = { types?: unknown; import?: unknown; module?: unknown; require?: unknown; default?: unknown; node?: unknown };

/** The `types` condition's value out of an `exports` subpath target: a string target itself (no explicit `types` condition, so none), or an object's `types`, else the first of `import`/`module`/`require`/`default`/`node` that has one. */
function typesFromTarget(target: unknown): string | undefined {
  if (typeof target === "string") return undefined;
  if (target === null || typeof target !== "object" || Array.isArray(target)) return undefined;
  const obj = target as ExportConditions;
  if (typeof obj.types === "string") return obj.types;
  for (const condition of ["import", "module", "require", "default", "node"] as const) {
    const nested = typesFromTarget(obj[condition]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** The JavaScript file an `exports` subpath target points at: a string target itself, or the first of `import`/`module`/`require`/`default`/`node` that has one. */
function codeFromTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (target === null || typeof target !== "object" || Array.isArray(target)) return undefined;
  const obj = target as ExportConditions;
  for (const condition of ["import", "module", "require", "default", "node"] as const) {
    const nested = codeFromTarget(obj[condition]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

const SIBLING_TYPES_EXTENSIONS: ReadonlyArray<readonly [string, string]> = [
  [".js", ".d.ts"],
  [".mjs", ".d.mts"],
  [".cjs", ".d.cts"],
];

/**
 * The `.d.ts` file next to `codeRel` (`./dist/index.js` -> `./dist/index.d.ts`)
 * when it exists, as TypeScript finds typings for an `exports` target that
 * has no `types` condition (`@ionic/angular` publishes its typings this way).
 * An extensionless `codeRel` names `<codeRel>.d.ts` or `<codeRel>/index.d.ts`.
 * Undefined when there's no such file.
 */
function siblingTypesOf(pkgDir: string, codeRel: string | undefined): string | undefined {
  if (codeRel === undefined) return undefined;
  for (const [codeExt, typesExt] of SIBLING_TYPES_EXTENSIONS) {
    if (!codeRel.endsWith(codeExt)) continue;
    const typesRel = codeRel.slice(0, -codeExt.length) + typesExt;
    return existsSync(resolve(pkgDir, typesRel)) ? typesRel : undefined;
  }
  if (/\.[a-z]+$/i.test(codeRel)) return undefined;
  return [`${codeRel}.d.ts`, `${codeRel}/index.d.ts`].find((typesRel) => existsSync(resolve(pkgDir, typesRel)));
}

