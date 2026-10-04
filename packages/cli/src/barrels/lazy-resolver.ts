import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative } from "node:path";
import { parse as babelParse, type ParserPlugin } from "@babel/parser";
import {
  posixPath,
  externalSubpath,
  packageNameFromSpecifier,
  type ExternalLeafResult,
} from "@scoutui/reference-graph";
import type { ChainBailedCode } from "@scoutui/scan-format";
import { type Diagnostic, type DiagnosticCollector, createDiagnosticCollector } from "../diagnostic.js";
import {
  parseBarrelTopLevel,
  parseBarrelTopLevelFromAst,
  type BarrelReExport,
} from "./barrel-parser.js";
import type { ResolveImport } from "../walker/resolve-import.js";

export type CreateLazyResolverOptions = {
  resolveImport: ResolveImport;
  /**
   * Base for repo-relative diagnostic paths. Resolution itself is anchored on
   * the calling file.
   */
  repoRoot?: string;
  /**
   * Shared diagnostic collector. Without one, the resolver keeps its own,
   * read through `diagnostics()`.
   */
  collector?: DiagnosticCollector;
};

/**
 * The most re-export hops one resolution may walk. Real chains stop around 10
 * hops. Past the limit the walk bails with a `chain-too-deep` diagnostic and
 * names no leaf, rather than a wrong one.
 */
const MAX_REEXPORT_HOPS = 32;

/** A re-export a walk follows: the specifier it leads to and the export it
 *  asks the target for. `namespace` marks an `export * as` of the name: the
 *  name is the target module itself, so a walk ends in it, still carrying
 *  the name. */
type ReExportHop = { from: string; targetExport: string; namespace?: true };

/** The last hop of a walk that entered another package: the specifier it
 *  entered by and the export it asked that entry for. */
type LeafCrossing = { specifier: string; exportName: string };

/** A finished walk: the package of its terminal file, and the `crossing`
 *  into that leaf package, absent when the walk never left the package the
 *  import reached; or the reason the walk bailed. */
type LeafWalk = { leafPackage: string; crossing?: LeafCrossing } | { bailed: ChainBailedCode };

export interface LazyResolver {
  /**
   * Engine-adapter entry point (`resolveExternalLeaf`): walks the import's
   * re-export chain and returns the leaf package, the public entry the chain
   * last crossed into it by and the name requested there, or the reason the
   * walk bailed. The terminal file is never returned.
   */
  lookupExternalLeaf(fromFile: string, specifier: string, exportName: string): ExternalLeafResult;
  diagnostics(): Diagnostic[];
  /**
   * Test-only: how many times the barrel at this path was parsed. Parses are
   * cached per absolute path, so this stays 1 however many resolutions cross
   * the barrel.
   */
  _barrelParseCount(absPath: string): number;
}

export function createLazyResolver(opts: CreateLazyResolverOptions): LazyResolver {
  const { resolveImport } = opts;
  const repoRoot = opts.repoRoot;
  // Repo-root-relative POSIX, so diagnostic paths match across machines.
  // Absolute when there is no repoRoot.
  const toRelPath = (abs: string): string =>
    repoRoot && isAbsolute(abs) ? posixPath(relative(repoRoot, abs)) : abs;

  // (absoluteFilePath::exportName) → cached walk (or null for negative cache).
  const hitCache = new Map<string, LeafWalk | null>();
  const collector = opts.collector ?? createDiagnosticCollector();

  // Top-level exports per absolute path (null when the file can't be read).
  // Deep re-export chains revisit the same barrel many times in one scan.
  const barrelCache = new Map<string, BarrelReExport[] | null>();
  const barrelParseCounts = new Map<string, number>();

  function parsedBarrel(absPath: string): BarrelReExport[] | null {
    const hit = barrelCache.get(absPath);
    if (hit !== undefined) return hit;
    const source = safeReadFile(absPath);
    const reExports = source === null ? null : parseExports(absPath, source);
    barrelCache.set(absPath, reExports);
    return reExports;
  }

  function parseExports(absPath: string, source: string): BarrelReExport[] {
    barrelParseCounts.set(absPath, (barrelParseCounts.get(absPath) ?? 0) + 1);
    const ext = extname(absPath).toLowerCase();
    const plugins: ParserPlugin[] = ["typescript", "decorators-legacy", "classProperties"];
    if (ext !== ".ts" && ext !== ".mts" && ext !== ".cts") plugins.push("jsx");
    try {
      return parseBarrelTopLevelFromAst(babelParse(source, { sourceType: "module", plugins, errorRecovery: true }));
    } catch {
      // babelParse throws on unrecoverable syntax. The source-level parse
      // returns an empty array on parse errors, so the chain ends at that file.
      return parseBarrelTopLevel(source);
    }
  }

  // Where `absPath` gets its export `name`, by the ES rule: the file's own
  // exports first (declared, `export * as`, `export { … } from`), then each
  // `export *` in source order, the first whose target provides the name.
  // `default` never passes through `export *`. Returns "here" when the file
  // declares the name, the hop that carries it on, or null when the file
  // isn't seen to export it. A star into a `file::name` pair already in
  // `seen` is skipped, and stars are followed at most `hopsLeft` deep.
  function locateExport(absPath: string, name: string, seen: Set<string>, hopsLeft: number): "here" | ReExportHop | null {
    const reExports = parsedBarrel(absPath) ?? [];
    for (const re of reExports) {
      if (re.kind === "own" && re.exported === name) return "here";
      if (re.kind === "namespace" && re.exported === name) return { from: re.from, targetExport: name, namespace: true };
      if (re.kind === "named") {
        const found = re.names.find((n) => n.exported === name);
        if (found) return { from: re.from, targetExport: found.local };
      }
    }
    if (name === "default" || hopsLeft === 0) return null;
    for (const re of reExports) {
      if (re.kind !== "star") continue;
      const target = resolveImport(absPath, re.from);
      if (target === null || seen.has(`${target}::${name}`)) continue;
      seen.add(`${target}::${name}`);
      if (locateExport(target, name, seen, hopsLeft - 1) !== null) return { from: re.from, targetExport: name };
    }
    return null;
  }

  // The hop a walk takes to carry `exportName` out of `fromAbs`: the one
  // `locateExport` finds, skipping stars back into the walk's `visited`
  // pairs. Null when the file declares the name, or when no re-export can
  // carry it on (no `export *`, or `default`, which `export *` never carries).
  function pickReExportFor(fromAbs: string, exportName: string, visited: Set<string>): ReExportHop | null {
    const found = locateExport(fromAbs, exportName, new Set(visited), MAX_REEXPORT_HOPS);
    if (found === "here") return null;
    if (found !== null || exportName === "default") return found;
    // No star target is seen to provide the name: follow the first `export *`.
    const firstStar = parsedBarrel(fromAbs)?.find((re) => re.kind === "star");
    return firstStar ? { from: firstStar.from, targetExport: exportName } : null;
  }

  // The walk and cache behind `lookupExternalLeaf`.
  function resolveLeaf(fromFile: string, specifier: string, exportName: string): LeafWalk | null {
    const initialAbs = resolveImport(fromFile, specifier);
    if (!initialAbs) return null;

    // A target in the importer's own package is local: return null and leave
    // it to the engine. A target in another named package, installed or a
    // workspace sibling, is external and walked to its leaf package, so it
    // gets package identity. findPackageRoot skips package.json files without
    // a `name`.
    const fromPkg = findPackageRoot(fromFile);
    const initialPkg = findPackageRoot(initialAbs);
    if (fromPkg && initialPkg && fromPkg.name === initialPkg.name) {
      return null;
    }

    const cacheKey = `${initialAbs}::${exportName}`;
    if (hitCache.has(cacheKey)) return hitCache.get(cacheKey) ?? null;

    const visited = new Set<string>();
    let currentAbs: string = initialAbs;
    let currentExport: string = exportName;
    let currentPkg = initialPkg;
    let crossing: LeafCrossing | undefined;
    const bail = (code: ChainBailedCode): LeafWalk => {
      const bailed: LeafWalk = { bailed: code };
      hitCache.set(cacheKey, bailed);
      return bailed;
    };

    // Walk the re-export chain, bailing with `chain-too-deep` after
    // MAX_REEXPORT_HOPS hops.
    let hops = 0;
    while (true) {
      const visitKey = `${currentAbs}::${currentExport}`;
      if (visited.has(visitKey)) {
        const cyclePkg = currentPkg?.name;
        collector.emit({
          code: "cycle-detected",
          severity: "warning",
          filePath: toRelPath(currentAbs),
          exportName: currentExport,
          ...(cyclePkg !== undefined ? { packageName: cyclePkg } : {}),
        });
        return bail("cycle-detected");
      }
      visited.add(visitKey);

      const reExports = parsedBarrel(currentAbs);
      if (reExports === null) break;
      // A file with no parsed exports is terminal, including unsupported
      // barrel forms (wrapped in try/switch, dynamic re-exports).
      if (reExports.length === 0) break;

      const next = pickReExportFor(currentAbs, currentExport, visited);
      if (!next) break; // terminal: the file declares the name, or nothing carries it on

      const nextAbs = resolveImport(currentAbs, next.from);
      if (!nextAbs) break; // unresolvable next hop → treat current as terminal

      if (hops >= MAX_REEXPORT_HOPS) {
        const deepPkg = currentPkg?.name;
        collector.emit({
          code: "chain-too-deep",
          severity: "warning",
          filePath: toRelPath(currentAbs),
          exportName: currentExport,
          depth: MAX_REEXPORT_HOPS,
          ...(deepPkg !== undefined ? { packageName: deepPkg } : {}),
        });
        return bail("chain-too-deep");
      }
      // A hop into another package enters it through `next.from`, asking its
      // entry for `next.targetExport`. The last crossing names the leaf's
      // entry; hops inside the leaf after it only move the terminal file.
      const nextPkg = findPackageRoot(nextAbs);
      if (nextPkg?.name !== currentPkg?.name) {
        crossing = { specifier: next.from, exportName: next.targetExport };
      }
      currentAbs = nextAbs;
      currentExport = next.targetExport;
      currentPkg = nextPkg;
      hops++;
      if (next.namespace) break; // terminal: the name is this module
    }

    // The terminal file's package root.
    const pkg = currentPkg;
    if (!pkg) {
      hitCache.set(cacheKey, null);
      return null;
    }

    const walk: LeafWalk = crossing === undefined ? { leafPackage: pkg.name } : { leafPackage: pkg.name, crossing };
    hitCache.set(cacheKey, walk);
    return walk;
  }

  // Engine-adapter entry point over `resolveLeaf`'s walk. A walk that never
  // left the package the import reached enters the leaf through the
  // caller's own specifier.
  function lookupExternalLeaf(fromFile: string, specifier: string, exportName: string): ExternalLeafResult {
    const walk = resolveLeaf(fromFile, specifier, exportName);
    if (walk === null || "bailed" in walk) return walk;
    const { leafPackage } = walk;
    const entry = walk.crossing ?? { specifier, exportName };
    // The subpath follows the name the entry was imported by, which is not
    // the leaf's own name under an npm alias (`"my-icons": "npm:@real/icons"`).
    const entryPackage = packageNameFromSpecifier(entry.specifier) ?? leafPackage;
    return {
      leafPackage,
      publicEntry: externalSubpath(entryPackage, entry.specifier) ?? "",
      exportName: entry.exportName,
    };
  }

  return {
    lookupExternalLeaf,
    diagnostics: () => collector.drain(),
    _barrelParseCount(absPath: string): number {
      return barrelParseCounts.get(absPath) ?? 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The package `absFile` is in: the nearest directory above it whose
 *  `package.json` has a `name`, with that name. Null when there is none. */
export function findPackageRoot(absFile: string): { name: string; dir: string } | null {
  let dir = dirname(absFile);
  while (dir !== dirname(dir)) {
    const pkgJson = join(dir, "package.json");
    if (existsSync(pkgJson)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as { name?: string };
        if (pkg.name) return { name: pkg.name, dir };
      } catch {
        // Continue walking if unreadable.
      }
    }
    dir = dirname(dir);
  }
  return null;
}

function safeReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
