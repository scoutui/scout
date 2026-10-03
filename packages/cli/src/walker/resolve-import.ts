import { realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve as pathResolve } from "node:path";
import type { ResolveImport } from "@scoutui/reference-graph";
import { loadTsconfigChain, compileAliasPattern, type AliasEntry } from "./tsconfig-loader.js";
import { buildWorkspaceExportEntries } from "./workspace-exports.js";
import type { PackageAliasLayer } from "./package-alias-layers.js";
import type { WorkspaceGraph } from "../workspace/types.js";
export type { ResolveImport } from "@scoutui/reference-graph";

/**
 * Module specifier resolver layered on top of Node's module resolution.
 *
 * Resolution order (first hit wins):
 *   1. Config `aliases` (explicit user-supplied alias map).
 *   2. The owning workspace package's own tsconfig `paths` layer (when
 *      `packageAliasLayers` provided and `from` sits inside a member).
 *   3. `compilerOptions.paths` from the tsconfig at `tsconfigPath`.
 *   4. `compilerOptions.baseUrl`, for a non-relative specifier: the owning
 *      workspace member's first, then the one from `tsconfigPath`. Hits only
 *      when a file exists under it (`app/Banner` → `<baseUrl>/app/Banner.tsx`).
 *   5. `package.json#exports` from each workspace package (when `workspaceGraph` provided).
 *   6. Node module resolution via `require.resolve`.
 *
 * Returns the absolute path of the resolved file, or `null` if no layer
 * matches.
 *
 * Results are memoised by the caller's directory and the specifier: the
 * walker and the reference-graph engine query the same pairs repeatedly, and
 * an uncached call can make ~18 statSync probes per alias target or baseUrl
 * directory. The result depends only on the caller's directory, since alias
 * targets resolve against fixed bases and require.resolve's `paths` come
 * from that directory.
 */

const FILE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".vue"] as const;

/** `.`, `..`, `./x`, `../x`: relative specifiers, which `baseUrl` never applies to. */
const RELATIVE_SPECIFIER = /^\.\.?(?:$|[\\/])/;

/**
 * TypeScript ESM spellings. Under `moduleResolution: node16|nodenext`
 * a relative specifier names the emitted file (`./Leaf.js`) while the source
 * on disk is `Leaf.ts`/`Leaf.tsx`. Mirror `tsc`'s mapping (`.js` → `.ts`,
 * `.tsx`; `.jsx` → `.tsx`) and probe those twins only after the spelled file
 * itself is missing, so a real `.js` on disk still wins.
 */
const TS_SOURCE_TWINS: ReadonlyArray<readonly [emitted: string, sources: readonly string[]]> = [
  [".js", [".ts", ".tsx"]],
  [".jsx", [".tsx"]],
];

function tsSourceSpellings(spec: string): string[] {
  for (const [emitted, sources] of TS_SOURCE_TWINS) {
    if (spec.endsWith(emitted)) {
      const stem = spec.slice(0, -emitted.length);
      return sources.map((ext) => `${stem}${ext}`);
    }
  }
  return [];
}

export type CreateImportResolverOptions = {
  repoRoot: string;
  /** Map of alias pattern → array of target patterns, both using `*` as the wildcard. */
  aliases?: Record<string, string[]>;
  /** Absolute path to a tsconfig.json whose `compilerOptions.paths` and `baseUrl` should layer in. */
  tsconfigPath?: string;
  /**
   * Workspace graph. When provided, each package's `package.json#exports` map
   * contributes a resolver layer between tsconfig paths and Node `require.resolve`.
   * See workspace-exports.ts for the supported `exports` shapes.
   */
  workspaceGraph?: WorkspaceGraph;
  /** Per-workspace-package tsconfig alias layers; the layer whose pkgRealPath
   *  owns `from` is applied between config aliases and the root tsconfig layer,
   *  and its `baseUrlDir` is probed before the root tsconfig's. */
  packageAliasLayers?: PackageAliasLayer[];
  /** Called once per non-fatal warning produced while loading the tsconfig chain
   *  (unreadable file, parse error, unresolvable extends, cycle). Invoked at
   *  resolver construction time, not per resolution call. */
  onWarning?: (message: string) => void;
};

export function createImportResolver(opts: CreateImportResolverOptions): ResolveImport {
  const configEntries = compileAliasMap(opts.aliases, opts.repoRoot);
  const tsconfigLayer = loadTsconfigLayer(opts.tsconfigPath, opts.repoRoot, opts.onWarning);
  const workspaceExportEntries: AliasEntry[] = opts.workspaceGraph
    ? buildWorkspaceExportEntries(opts.workspaceGraph)
    : [];
  const pkgLayers = opts.packageAliasLayers ?? [];
  const fromDirRealCache = new Map<string, string>();
  const ownerLayerFor = (fromDir: string): PackageAliasLayer | undefined => {
    if (pkgLayers.length === 0) return undefined;
    let real = fromDirRealCache.get(fromDir);
    if (real === undefined) {
      try {
        real = realpathSync(fromDir);
      } catch {
        real = fromDir;
      }
      fromDirRealCache.set(fromDir, real);
    }
    for (const layer of pkgLayers) {
      const withSep = layer.pkgRealPath.endsWith("/") ? layer.pkgRealPath : `${layer.pkgRealPath}/`;
      if (real === layer.pkgRealPath || real.startsWith(withSep)) return layer;
    }
    return undefined;
  };

  // Reused for `require.resolve` fallback. Anchoring at <repoRoot>/_ ensures
  // Node walks up through <repoRoot>/node_modules and parents.
  const requireFromRepo = createRequire(pathResolve(opts.repoRoot, "_"));

  const cache = new Map<string, string | null>();

  return function resolveImport(from: string, spec: string): string | null {
    // `require.resolve`'s `paths` need absolute directories. Callers should
    // pass an absolute `from`: a relative one is resolved against this
    // resolver's repoRoot, which is only right when that is the caller's anchor.
    const absFrom = isAbsolute(from) ? from : pathResolve(opts.repoRoot, from);
    const fromDir = dirname(absFrom);

    const cacheKey = `${fromDir}\0${spec}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const result = resolveUncached(fromDir, spec);
    cache.set(cacheKey, result);
    return result;
  };

  function resolveUncached(fromDir: string, spec: string): string | null {
    const owner = ownerLayerFor(fromDir);
    const aliased = resolveAliasEntries([configEntries, owner?.entries ?? [], tsconfigLayer.entries], spec);
    if (aliased) return aliased;

    if (!RELATIVE_SPECIFIER.test(spec) && !isAbsolute(spec)) {
      // A Set: the root tsconfig's baseUrl is not probed twice when it is the member's own.
      for (const baseUrlDir of new Set([owner?.baseUrlDir, tsconfigLayer.baseUrlDir])) {
        const hit = baseUrlDir ? tryFileWithExtensions(pathResolve(baseUrlDir, spec)) : null;
        if (hit) return hit;
      }
    }

    const exported = resolveAliasEntries([workspaceExportEntries], spec);
    if (exported) return exported;

    // Plain relative or bare resolution via Node. require.resolve doesn't try
    // TS/JSX/Vue extensions, so probe them after it fails, as
    // tryFileWithExtensions does for aliases.
    try {
      return requireFromRepo.resolve(spec, { paths: [fromDir, opts.repoRoot] });
    } catch {
      // `./Leaf.js` → `./Leaf.tsx` (TypeScript ESM). Before the
      // append-an-extension probes: `./Leaf.js.tsx` can never exist.
      for (const twin of tsSourceSpellings(spec)) {
        try {
          return requireFromRepo.resolve(twin, { paths: [fromDir, opts.repoRoot] });
        } catch {
          // continue
        }
      }
      for (const ext of FILE_EXTENSIONS) {
        try {
          return requireFromRepo.resolve(`${spec}${ext}`, { paths: [fromDir, opts.repoRoot] });
        } catch {
          // continue
        }
      }
      // Node only resolves a directory to `index.js`/`.json`/`.node`, so probe
      // the other extensions too (`import "./modal"` → `modal/index.jsx`).
      for (const ext of FILE_EXTENSIONS) {
        try {
          return requireFromRepo.resolve(`${spec}/index${ext}`, { paths: [fromDir, opts.repoRoot] });
        } catch {
          // continue
        }
      }
      // Folder-with-basename: `./avatar` → `./avatar/avatar.{ext}`,
      // the Next.js convention. Gated on relative specs because bare-package
      // imports have a `main` field and don't use this shape.
      if (spec.startsWith(".")) {
        const segments = spec.split("/");
        const basename = segments[segments.length - 1];
        if (basename) {
          for (const ext of FILE_EXTENSIONS) {
            try {
              return requireFromRepo.resolve(`${spec}/${basename}${ext}`, {
                paths: [fromDir, opts.repoRoot],
              });
            } catch {
              // continue
            }
          }
        }
      }
      return null;
    }
  }
}

function compileAliasMap(
  aliases: Record<string, string[]> | undefined,
  base: string,
): AliasEntry[] {
  if (!aliases) return [];
  const out: AliasEntry[] = [];
  for (const [key, targets] of Object.entries(aliases)) {
    out.push({ pattern: compileAliasPattern(key), targets, base });
  }
  return out;
}

function loadTsconfigLayer(
  tsconfigPath: string | undefined,
  repoRoot: string,
  onWarning?: (message: string) => void,
): { entries: AliasEntry[]; baseUrlDir: string | undefined } {
  if (!tsconfigPath) return { entries: [], baseUrlDir: undefined };
  const { entries, baseUrlDir, warnings } = loadTsconfigChain(tsconfigPath, repoRoot);
  if (onWarning) for (const w of warnings) onWarning(w);
  return { entries, baseUrlDir };
}

/** The first existing file named by a matching alias entry, layers in order. */
function resolveAliasEntries(layers: AliasEntry[][], spec: string): string | null {
  for (const entries of layers) {
    for (const entry of entries) {
      const m = entry.pattern.exec(spec);
      if (!m) continue;
      const wildcard = m[1] ?? "";
      for (const target of entry.targets) {
        const hit = tryFileWithExtensions(pathResolve(entry.base, target.replace(/\*/g, wildcard)));
        if (hit) return hit;
      }
    }
  }
  return null;
}

/**
 * Tries the path as-is, as its TypeScript source twin (`.js` → `.ts`/`.tsx`),
 * with each extension, as a directory with `index.{ext}`, and finally as a
 * directory with `<basename>.{ext}` (the Next.js folder
 * convention also used by some React Native projects: `./avatar` resolves to
 * `./avatar/avatar.tsx`). Returns null when none of them is a file.
 */
function tryFileWithExtensions(absPath: string): string | null {
  if (!isAbsolute(absPath)) return null;
  if (isFile(absPath)) return absPath;
  for (const twin of tsSourceSpellings(absPath)) {
    if (isFile(twin)) return twin;
  }
  for (const ext of FILE_EXTENSIONS) {
    const withExt = absPath + ext;
    if (isFile(withExt)) return withExt;
  }
  for (const ext of FILE_EXTENSIONS) {
    const indexPath = pathResolve(absPath, `index${ext}`);
    if (isFile(indexPath)) return indexPath;
  }
  // Folder-with-basename: `./avatar` → `./avatar/avatar.{ext}`. Node doesn't
  // try this; Next.js does.
  const segments = absPath.split(/[\\/]/);
  const basename = segments[segments.length - 1];
  if (basename) {
    for (const ext of FILE_EXTENSIONS) {
      const basenamePath = pathResolve(absPath, `${basename}${ext}`);
      if (isFile(basenamePath)) return basenamePath;
    }
  }
  return null;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
