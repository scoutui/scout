import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve as pathResolve } from "node:path";
import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";

/** Compiled alias record consumed by `createImportResolver`. */
export type AliasEntry = {
  /** Anchored regex matching the specifier; capture group 1 is the wildcard expansion. */
  pattern: RegExp;
  /** Substitution targets in declaration order. `*` is replaced with the captured wildcard. */
  targets: string[];
  /** Absolute directory anchoring `targets` (the effective baseUrl of the file that declared `paths`). */
  base: string;
};

export type LoadTsconfigChainResult = {
  entries: AliasEntry[];
  /** Absolute effective `baseUrl` directory of the chain; undefined when no file in it sets `baseUrl`. */
  baseUrlDir: string | undefined;
  warnings: string[];
};

type ParsedTsconfig = {
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
  extends?: string | string[];
  files?: string[];
  include?: string[];
  references?: Array<{ path: string }>;
};

const REGEX_META = /[.+?^${}()|[\]\\]/g;

/**
 * Load a tsconfig and its `extends` chain, returning a flat list of alias
 * entries and the effective `baseUrl` directory, ready for
 * `createImportResolver`. Non-fatal failures (missing files, JSONC errors,
 * cycles) go to `warnings` rather than being thrown.
 *
 * Inheritance semantics match TypeScript:
 *   - `extends` is a string or an array of strings; arrays apply in order,
 *     later overrides earlier.
 *   - `compilerOptions.paths` is replaced, not merged. If the child defines
 *     `paths`, the child wins entirely; otherwise the parent's flows through.
 *   - `compilerOptions.baseUrl` is replaced too, anchored to the file that
 *     defines it.
 *   - Each `AliasEntry.base` pins to the effective baseUrl of the file that
 *     contributed its `paths` (so the resolver doesn't need to know which
 *     file produced which entry).
 *
 * A solution-style tsconfig (`files: []`, no `include`, and `references`)
 * compiles nothing itself, so its aliases are those of the projects it
 * references, in reference order, then its own and its `extends` chain's:
 * the first to declare a pattern wins it, and the first to set `baseUrl`
 * sets `baseUrlDir`. A referenced project that doesn't exist, such as a
 * framework's generated tsconfig before its codegen has run, contributes
 * nothing.
 */
export function loadTsconfigChain(absPath: string): LoadTsconfigChainResult {
  const warnings: string[] = [];
  const entries: AliasEntry[] = [];
  const declared = new Set<string>();
  let baseUrlDir: string | undefined;
  for (const project of solutionProjects(absPath)) {
    const merged = loadChainInner(project, new Set<string>(), warnings);
    if (!merged) continue;
    baseUrlDir ??= merged.baseUrlDir;
    for (const [pattern, targets] of Object.entries(merged.paths ?? {})) {
      if (declared.has(pattern)) continue;
      declared.add(pattern);
      entries.push({
        pattern: compileAliasPattern(pattern),
        targets,
        base: merged.baseDir,
      });
    }
  }
  return { entries, baseUrlDir, warnings };
}

/** The existing projects a solution-style tsconfig references, then the tsconfig itself; or just the tsconfig. */
function solutionProjects(absPath: string): string[] {
  const parsed = readAndParse(absPath, []);
  if (parsed?.files?.length !== 0 || parsed.include !== undefined || !parsed.references?.length) return [absPath];
  const references = parsed.references.map((ref) => referencedTsconfig(absPath, ref.path)).filter((path) => existsSync(path));
  return [...references, absPath];
}

/** A reference names a tsconfig file, or a directory holding `tsconfig.json`. */
function referencedTsconfig(fromAbs: string, refPath: string): string {
  const target = pathResolve(dirname(fromAbs), refPath);
  return existsSync(target) && statSync(target).isDirectory() ? join(target, "tsconfig.json") : target;
}

type MergedPaths = {
  paths: Record<string, string[]> | undefined;
  /** Directory used to anchor `paths` when constructing AliasEntry.base. */
  baseDir: string;
  /** Directory of the nearest `baseUrl` in the chain; undefined when none sets it. */
  baseUrlDir: string | undefined;
};

function loadChainInner(
  absPath: string,
  seen: Set<string>,
  warnings: string[],
): MergedPaths | null {
  if (seen.has(absPath)) {
    warnings.push(`tsconfig extends cycle at ${absPath}; ignoring this hop`);
    return null;
  }
  seen.add(absPath);

  const parsed = readAndParse(absPath, warnings);
  if (!parsed) return null;

  // Resolve parents first, then apply this file's overrides on top.
  let inherited: MergedPaths | null = null;
  if (parsed.extends) {
    const parents = Array.isArray(parsed.extends) ? parsed.extends : [parsed.extends];
    for (const ext of parents) {
      const parentAbs = resolveExtends(absPath, ext, warnings);
      if (!parentAbs) continue;
      const parentResult = loadChainInner(parentAbs, seen, warnings);
      if (!parentResult) continue;
      inherited = mergeOverride(inherited, parentResult);
    }
  }

  const ownBaseDir = effectiveBaseDir(absPath, parsed);
  const own: MergedPaths = {
    paths: parsed.compilerOptions?.paths,
    baseDir: ownBaseDir,
    baseUrlDir: parsed.compilerOptions?.baseUrl ? ownBaseDir : undefined,
  };
  return mergeOverride(inherited, own);
}

function readAndParse(absPath: string, warnings: string[]): ParsedTsconfig | null {
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch (err) {
    warnings.push(`tsconfig not readable at ${absPath}: ${(err as Error).message}`);
    return null;
  }
  const errors: ParseError[] = [];
  const parsed = parseJsonc(raw, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    const messages = errors.map((e) => printParseErrorCode(e.error)).join(", ");
    warnings.push(`tsconfig parse errors in ${absPath}: ${messages}`);
    if (parsed === undefined) return null;
  }
  if (parsed === null || typeof parsed !== "object") {
    warnings.push(`tsconfig at ${absPath} did not produce an object`);
    return null;
  }
  return parsed as ParsedTsconfig;
}

function resolveExtends(
  fromAbs: string,
  spec: string,
  warnings: string[],
): string | null {
  // Relative paths resolve from the importing file's directory. Bare specs
  // (e.g. "@tsconfig/node20/tsconfig.json") go through Node module resolution
  // anchored at the same location.
  const fromDir = dirname(fromAbs);
  if (spec.startsWith(".") || isAbsolute(spec)) {
    const candidate = isAbsolute(spec) ? spec : pathResolve(fromDir, spec);
    // TS conventions: if the path ends without .json, try appending it.
    const withExt = candidate.endsWith(".json") ? candidate : `${candidate}.json`;
    return withExt;
  }
  try {
    const req = createRequire(fromAbs);
    return req.resolve(spec);
  } catch (err) {
    warnings.push(`tsconfig extends "${spec}" from ${fromAbs} did not resolve`);
    return null;
  }
}

function effectiveBaseDir(absPath: string, parsed: ParsedTsconfig): string {
  const fileDir = dirname(absPath);
  const baseUrl = parsed.compilerOptions?.baseUrl;
  if (!baseUrl) return fileDir;
  return pathResolve(fileDir, baseUrl);
}

function mergeOverride(parent: MergedPaths | null, child: MergedPaths): MergedPaths {
  // TS replace semantics: if child has paths, child wins entirely; otherwise
  // parent's paths flow through. Each MergedPaths carries the baseDir tied to
  // the *paths* it owns. `baseUrlDir` is replaced independently: the child's
  // own `baseUrl` wins, otherwise the parent's flows through.
  const baseUrlDir = child.baseUrlDir ?? parent?.baseUrlDir;
  if (child.paths) return { ...child, baseUrlDir };
  if (parent?.paths) return { ...parent, baseUrlDir };
  return { ...child, baseUrlDir };
}

/** Compile a TS-paths-style alias pattern into an anchored RegExp. The single
 *  `*` wildcard becomes capture group 1, available for substitution into the
 *  target. Shared between tsconfig-derived and config-derived alias entries. */
export function compileAliasPattern(pattern: string): RegExp {
  return new RegExp(`^${pattern.replace(REGEX_META, "\\$&").replace(/\*/g, "(.*)")}$`);
}
