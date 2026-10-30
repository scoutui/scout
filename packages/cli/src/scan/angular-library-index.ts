/**
 * Angular library index: reads an installed Angular library's partially
 * compiled `.d.ts` typings to recover every component, NgModule, and
 * directive a bare import specifier makes available, without running the
 * Angular compiler.
 *
 * Angular's compiler stamps each compiled class with a static describing it:
 * `ɵcmp: i0.ɵɵComponentDeclaration<Class, Selector, ExportAs, Inputs, Outputs, ...>`,
 * `ɵmod: i0.ɵɵNgModuleDeclaration<Class, Declarations, Imports, Exports>`, or
 * `ɵdir: i0.ɵɵDirectiveDeclaration<Class, Selector, ...>` (reported as a
 * `LibraryDirective` - its selector still names a real Angular element, but
 * it renders nothing of its own, so it's never a `LibraryComponent`). This
 * module parses those type arguments directly; it never runs or bundles
 * `@angular/compiler`.
 *
 * An entry point is found through `package.json#exports[subpath].types`
 * (falling back to `types`/`typings` for the root entry, when there is no
 * `exports` map). A declaration may live in the entry file itself or be
 * re-exported from a "chunk" file the entry imports - as a re-export with a
 * source (`export { X } from './_x-chunk.js'`, `export * from './y.js'`), or
 * as a plain `export { X };` of a name the entry otherwise only `import`s
 * from the chunk; this module follows both forms, bounded and cycle-safe, to
 * find the declaring class while still reporting it under the specifier the
 * user imported it from. An `ɵmod`'s `Exports` type argument may `typeof` a
 * class from another installed package (`typeof i2.BidiModule`, from
 * `import * as i2 from '@angular/cdk/bidi'`); this module resolves that
 * specifier too and indexes it into the same result, transitively and
 * bounded, so a module re-exporting another package's module resolves.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseSync } from "oxc-parser";
import type {
  Class as OxcClass,
  ExportSpecifier,
  ModuleExportName,
  PropertyKey as OxcPropertyKey,
  TSType,
  TSTypeQueryExprName,
} from "@oxc-project/types";
import { readLiteralValue } from "../local-index/declared-props.js";

/** One library component, reported under the specifier the repo imports it from (never the file that declares it). */
export type LibraryComponent = {
  specifier: string;
  exportName: string;
  selector: string;
  /** Template-facing input names (each input's alias). */
  inputs: string[];
  /** Template-facing output names (each output's alias). */
  outputs: string[];
};

/** One library NgModule and what it makes available to a template that imports it. */
export type LibraryModule = {
  specifier: string;
  exportName: string;
  /** Every component, module, directive, etc. the module's `ɵmod` names as exported, resolved across packages. */
  exports: { specifier: string; exportName: string }[];
};

/**
 * One library directive (`ɵɵDirectiveDeclaration`) with an element selector,
 * e.g. Material's `mat-error`/`mat-label`: never a component (it renders
 * nothing of its own), but its selector still names a real Angular element,
 * not an unknown custom element.
 */
export type LibraryDirective = { specifier: string; exportName: string; selector: string };

/** A requested specifier whose typings are broken in some way a user can fix, with a reason they can act on. Not used for a package that's simply missing or has no typings - see `buildAngularLibraryIndex`. */
export type UnreadableLibrary = { specifier: string; reason: string };

export type AngularLibraryIndex = {
  components: LibraryComponent[];
  modules: LibraryModule[];
  directives: LibraryDirective[];
  unreadable: UnreadableLibrary[];
};

/**
 * Builds an Angular library index for every specifier in `specifiers` (bare
 * import specifiers the repo's Angular files import, such as
 * `"@example/ui/button"`), resolving installed packages from `configDir`.
 * Never throws. `unreadable` is for real problems only - typings that exist
 * but can't be parsed, or a declared `types` file that's missing - since the
 * caller surfaces it as a user-facing warning. Three things are left out of
 * `unreadable` and simply contribute nothing, silently: a package that isn't
 * installed (the caller already has its own warning for that), a package
 * with no typings at all (a plain JS library), and typings with no
 * `ɵcmp`/`ɵmod` (a library with no Angular declarations, such as `rxjs`).
 */
export function buildAngularLibraryIndex(opts: { configDir: string; specifiers: Iterable<string> }): AngularLibraryIndex {
  const ctx: Ctx = {
    fileCache: new Map(),
    components: [],
    modules: [],
    directives: [],
    unreadable: [],
    unreadableSpecifiers: new Set(),
    indexedSpecifiers: new Set(),
    exportsCache: new Map(),
    resolvingFiles: new Set(),
    budget: { remaining: 300 },
  };
  const configDir = resolve(opts.configDir);
  for (const specifier of opts.specifiers) indexSpecifier(ctx, specifier, configDir);
  return { components: ctx.components, modules: ctx.modules, directives: ctx.directives, unreadable: ctx.unreadable };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

type Ctx = {
  /** Parsed `.d.ts` files, by absolute path; null when the file was unreadable or failed to parse. */
  fileCache: Map<string, FileInfo | null>;
  components: LibraryComponent[];
  modules: LibraryModule[];
  directives: LibraryDirective[];
  unreadable: UnreadableLibrary[];
  unreadableSpecifiers: Set<string>;
  /** Specifiers already indexed (or attempted), so a cross-package reference is indexed once. */
  indexedSpecifiers: Set<string>;
  /** `resolveExports`'s memo, by file path: computed once per file for the whole call, however many entries reach it. */
  exportsCache: Map<string, Map<string, { decl: ClassDecl; file: string }>>;
  /** `resolveExports`'s cycle guard: files currently being resolved somewhere up the call stack. */
  resolvingFiles: Set<string>;
  /** Caps total indexing work across every specifier reached transitively. */
  budget: { remaining: number };
};

/** Bounds how deep one `export`/`import` chain is followed before `resolveExports` gives up (chunk + re-export hops; a cycle is caught sooner, by `resolvingFiles`). */
const MAX_FILES_PER_ENTRY = 64;

function addUnreadable(ctx: Ctx, specifier: string, reason: string): void {
  if (ctx.unreadableSpecifiers.has(specifier)) return;
  ctx.unreadableSpecifiers.add(specifier);
  ctx.unreadable.push({ specifier, reason });
}

/**
 * Indexes one specifier's entry into `ctx`, once. `fromDir` anchors package
 * resolution: `configDir` for a specifier the repo wrote, or the referencing
 * file's directory for one reached through a `typeof` reference in another
 * installed package (so a nested install under that package's own
 * `node_modules` is found first, same as Node).
 */
function indexSpecifier(ctx: Ctx, specifier: string, fromDir: string): void {
  if (ctx.indexedSpecifiers.has(specifier)) return;
  ctx.indexedSpecifiers.add(specifier);
  if (--ctx.budget.remaining < 0) return;

  const resolved = resolvePackageEntry(fromDir, specifier);
  // Not installed, or installed with no typings at all: both contribute
  // nothing, silently (see buildAngularLibraryIndex's doc comment for why).
  if (resolved.kind === "not-installed" || resolved.kind === "no-types") return;
  if (resolved.kind === "unreadable") {
    addUnreadable(ctx, specifier, resolved.reason);
    return;
  }

  let entryExports: Map<string, { decl: ClassDecl; file: string }>;
  try {
    entryExports = resolveExports(ctx, resolved.entryPath);
  } catch (e) {
    addUnreadable(ctx, specifier, `its typings could not be read (${e instanceof Error ? e.message : String(e)})`);
    return;
  }

  for (const [exportName, { decl, file }] of entryExports) {
    if (decl.kind === "component" && decl.selector !== undefined) {
      ctx.components.push({
        specifier,
        exportName,
        selector: decl.selector,
        inputs: Object.values(decl.inputs),
        outputs: Object.values(decl.outputs),
      });
    } else if (decl.kind === "module") {
      ctx.modules.push({
        specifier,
        exportName,
        exports: resolveModuleExports(ctx, decl.moduleExportRefs, file, specifier, entryExports),
      });
    } else if (decl.kind === "directive" && decl.selector !== undefined) {
      ctx.directives.push({ specifier, exportName, selector: decl.selector });
    }
  }
}

/**
 * The `{specifier, exportName}` a module's `ɵmod` Exports type argument names,
 * one per `typeof` reference. A bare `typeof Name` resolves within the same
 * entry: under the name it's exported as there when reachable through its
 * export chain, else (declared or merely imported in `declFile`) under its
 * local name, so it still addresses correctly even when the entry exports it
 * only for re-export elsewhere. A qualified `typeof ns.Name` resolves `ns`
 * through `declFile`'s own namespace imports: a relative one stays in the
 * same package (same specifier); a bare one is another installed package,
 * indexed into `ctx` so it appears in the result too.
 */
function resolveModuleExports(
  ctx: Ctx,
  refs: readonly TypeofRef[],
  declFile: string,
  ownerSpecifier: string,
  ownerExports: Map<string, { decl: ClassDecl; file: string }>,
): { specifier: string; exportName: string }[] {
  const declFileInfo = getFileInfo(ctx, declFile);
  const out: { specifier: string; exportName: string }[] = [];

  for (const ref of refs) {
    if (ref.kind === "qualified") {
      const nsSpecifier = declFileInfo?.namespaceImports.get(ref.ns);
      if (nsSpecifier === undefined) continue;
      if (isRelativeSpecifier(nsSpecifier)) {
        out.push({ specifier: ownerSpecifier, exportName: ref.name });
      } else {
        indexSpecifier(ctx, nsSpecifier, dirname(declFile));
        out.push({ specifier: nsSpecifier, exportName: ref.name });
      }
      continue;
    }

    const exportedAs = findExportedName(ownerExports, declFileInfo, declFile, ref.name);
    if (exportedAs !== undefined) {
      out.push({ specifier: ownerSpecifier, exportName: exportedAs });
      continue;
    }
    if (declFileInfo?.classes.has(ref.name)) {
      // Declared in this entry's own file graph, but not reachable through
      // its export chain (e.g. only used in the module's `imports`, never
      // re-exported). Still address it under the same specifier.
      out.push({ specifier: ownerSpecifier, exportName: ref.name });
      continue;
    }
    const imported = declFileInfo?.imports.get(ref.name);
    if (imported === undefined) continue;
    if (isRelativeSpecifier(imported.specifier)) {
      out.push({ specifier: ownerSpecifier, exportName: imported.imported });
    } else {
      indexSpecifier(ctx, imported.specifier, dirname(declFile));
      out.push({ specifier: imported.specifier, exportName: imported.imported });
    }
  }
  return out;
}

/** The name `exportsMap` exports `localName`'s class (declared in `file`) under, if any. */
function findExportedName(
  exportsMap: Map<string, { decl: ClassDecl; file: string }>,
  fileInfo: FileInfo | null,
  file: string,
  localName: string,
): string | undefined {
  const decl = fileInfo?.classes.get(localName);
  if (decl === undefined) return undefined;
  for (const [exportedName, entry] of exportsMap) {
    if (entry.file === file && entry.decl === decl) return exportedName;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Export-chain resolution (one entry's exported names -> declaring class)
// ---------------------------------------------------------------------------

type Reexport = { kind: "named"; source: string; pairs: { imported: string; exported: string }[] } | { kind: "star"; source: string };

/**
 * Every name `filePath` makes available, directly or by re-export, to
 * `{decl, file}` (the declaring class and the file it's declared in).
 * Memoized in `ctx.exportsCache`, by `filePath` alone: the result never
 * depends on who's asking, so one entry and a chunk file three other entries
 * also reach are each read and resolved once per `buildAngularLibraryIndex`
 * call. `ctx.resolvingFiles` is the cycle guard - a file already being
 * resolved higher up this same call stack (`export * from` loops between two
 * files, e.g.) contributes nothing further to that inner call, instead of
 * recursing forever; it's also a depth cap (`MAX_FILES_PER_ENTRY`) against a
 * very deep, non-cyclic chain.
 */
function resolveExports(ctx: Ctx, filePath: string): Map<string, { decl: ClassDecl; file: string }> {
  const cached = ctx.exportsCache.get(filePath);
  if (cached !== undefined) return cached;
  if (ctx.resolvingFiles.has(filePath) || ctx.resolvingFiles.size >= MAX_FILES_PER_ENTRY) return new Map();
  ctx.resolvingFiles.add(filePath);

  const result = new Map<string, { decl: ClassDecl; file: string }>();
  const info = getFileInfo(ctx, filePath);
  if (info !== null) {
    for (const [exportedName, localName] of info.localExports) {
      const decl = info.classes.get(localName);
      if (decl !== undefined) {
        result.set(exportedName, { decl, file: filePath });
        continue;
      }
      // Not a class declared here: `localName` may be a name this file only
      // `import`s (no re-export `from` clause at all), e.g. Material's
      // button-toggle.d.ts: `import { MatButtonToggle } from './_chunk.js';
      // ... export { MatButtonToggle };`. Follow the import the same way a
      // named re-export's source is followed.
      const imported = info.imports.get(localName);
      if (imported === undefined) continue;
      const childPath = resolveReexportTarget(ctx, filePath, imported.specifier);
      if (childPath === null) continue;
      const entry = resolveExports(ctx, childPath).get(imported.imported);
      if (entry !== undefined) result.set(exportedName, entry);
    }

    for (const re of info.reexports) {
      const childPath = resolveReexportTarget(ctx, filePath, re.source);
      if (childPath === null) continue;
      const childMap = resolveExports(ctx, childPath);
      if (re.kind === "star") {
        for (const [name, entry] of childMap) if (!result.has(name)) result.set(name, entry);
      } else {
        for (const pair of re.pairs) {
          const entry = childMap.get(pair.imported);
          if (entry !== undefined) result.set(pair.exported, entry);
        }
      }
    }
  }

  ctx.resolvingFiles.delete(filePath);
  ctx.exportsCache.set(filePath, result);
  return result;
}

/**
 * The file `source` (as written in a `.d.ts` re-export) resolves to: a
 * sibling file for a relative source, or another installed package's entry
 * for a bare one. A bare source is also indexed into `ctx` under its own
 * specifier, so a package only ever re-exporting another's component still
 * surfaces that other package's own entries.
 */
function resolveReexportTarget(ctx: Ctx, fromFile: string, source: string): string | null {
  if (isRelativeSpecifier(source)) return relativeDtsPath(fromFile, source);
  indexSpecifier(ctx, source, dirname(fromFile));
  const resolved = resolvePackageEntry(dirname(fromFile), source);
  return resolved.kind === "found" ? resolved.entryPath : null;
}

const isRelativeSpecifier = (specifier: string): boolean => specifier.startsWith(".");

/** `./_x-chunk.js` (or `.mjs`/`.cjs`, or extensionless) -> its sibling `.d.ts`, trying `index.d.ts` for a directory. Null when neither exists. */
function relativeDtsPath(fromFile: string, source: string): string | null {
  const base = resolve(dirname(fromFile), source).replace(/\.(m|c)?js$/, "");
  for (const candidate of [`${base}.d.ts`, join(base, "index.d.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// package.json#exports -> entry .d.ts
// ---------------------------------------------------------------------------

/**
 * `fromDir`'s installed `specifier` entry typings file, or why there isn't
 * one: `"not-installed"` and `"no-types"` are ordinary (nothing to read),
 * `"unreadable"` is a real problem a user can act on.
 */
type EntryResolution = { kind: "found"; entryPath: string } | { kind: "not-installed" } | { kind: "no-types" } | { kind: "unreadable"; reason: string };

function resolvePackageEntry(fromDir: string, specifier: string): EntryResolution {
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

/** The `types` (or `typings`) entry `subpath` resolves to in the package at `pkgDir`, reading `package.json#exports` when present. */
function resolveEntryTypesPath(pkgDir: string, subpath: string): EntryResolution {
  let pkg: { exports?: unknown; types?: unknown; typings?: unknown };
  try {
    pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  } catch {
    return { kind: "unreadable", reason: "its package.json is missing or isn't valid JSON" };
  }

  const key = subpath === "" ? "." : `./${subpath}`;
  let typesRel: string | undefined;
  if (pkg.exports !== undefined && pkg.exports !== null && typeof pkg.exports === "object" && !Array.isArray(pkg.exports)) {
    const exportsMap = pkg.exports as Record<string, unknown>;
    typesRel = typesFromTarget(exportsMap[key] ?? matchExportPattern(exportsMap, key));
  } else if (subpath === "") {
    typesRel = typeof pkg.types === "string" ? pkg.types : typeof pkg.typings === "string" ? pkg.typings : undefined;
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
  if (typeof value === "string") return value.replace("*", wildcard);
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

// ---------------------------------------------------------------------------
// One `.d.ts` file: its classes, imports, and exports
// ---------------------------------------------------------------------------

type TypeofRef = { kind: "bare"; name: string } | { kind: "qualified"; ns: string; name: string };

type ClassDecl = {
  kind: "component" | "module" | "directive" | "other";
  /** Set for `kind: "component"` or `"directive"` when its selector is a readable string literal; one without it is never reported. */
  selector: string | undefined;
  /** Input property name -> its template-facing alias. */
  inputs: Record<string, string>;
  /** Output property name -> its template-facing alias. */
  outputs: Record<string, string>;
  /** Set only for `kind: "module"`: its `ɵmod`'s Exports type argument, unresolved. */
  moduleExportRefs: TypeofRef[];
};

type FileInfo = {
  /** Classes declared directly in this file (by local name), whether or not this file exports them. */
  classes: Map<string, ClassDecl>;
  /** A named import's local name -> where it came from and what it's named there. */
  imports: Map<string, { specifier: string; imported: string }>;
  /** A namespace import's local name (`import * as ns from "..."`) -> its specifier. */
  namespaceImports: Map<string, string>;
  /** A name this file exports -> the local name (in this file) it exports. */
  localExports: Map<string, string>;
  /** `export {...} from "..."` and `export * from "..."` statements, in source order. */
  reexports: Reexport[];
};

function getFileInfo(ctx: Ctx, path: string): FileInfo | null {
  const cached = ctx.fileCache.get(path);
  if (cached !== undefined) return cached;
  let info: FileInfo | null;
  try {
    info = parseDtsFile(path);
  } catch {
    info = null;
  }
  ctx.fileCache.set(path, info);
  return info;
}

function parseDtsFile(path: string): FileInfo {
  const source = readFileSync(path, "utf8");
  const { program } = parseSync(path, source);

  const classes = new Map<string, ClassDecl>();
  const imports = new Map<string, { specifier: string; imported: string }>();
  const namespaceImports = new Map<string, string>();
  const localExports = new Map<string, string>();
  const reexports: Reexport[] = [];

  const registerClass = (node: OxcClass): void => {
    if (node.id !== null) classes.set(node.id.name, classDeclFrom(node));
  };

  for (const stmt of program.body) {
    if (stmt.type === "ClassDeclaration") {
      registerClass(stmt as unknown as OxcClass);
      continue;
    }
    if (stmt.type === "ImportDeclaration") {
      const specifier = stmt.source.value;
      for (const spec of stmt.specifiers) {
        if (spec.type === "ImportSpecifier") {
          imports.set(spec.local.name, { specifier, imported: moduleExportName(spec.imported) });
        } else if (spec.type === "ImportDefaultSpecifier") {
          imports.set(spec.local.name, { specifier, imported: "default" });
        } else if (spec.type === "ImportNamespaceSpecifier") {
          namespaceImports.set(spec.local.name, specifier);
        }
      }
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration !== null) {
        if (stmt.declaration.type === "ClassDeclaration") {
          const cls = stmt.declaration as unknown as OxcClass;
          registerClass(cls);
          if (cls.id !== null) localExports.set(cls.id.name, cls.id.name);
        }
        continue;
      }
      if (stmt.source === null) {
        for (const spec of stmt.specifiers) localExports.set(moduleExportName(spec.exported), moduleExportName(spec.local));
      } else {
        reexports.push({ kind: "named", source: stmt.source.value, pairs: reexportPairs(stmt.specifiers) });
      }
      continue;
    }
    if (stmt.type === "ExportAllDeclaration") {
      // `export * as ns from "..."` names a namespace, not individual
      // components/modules; left unhandled (rare in Angular library typings).
      if (stmt.exported === null) reexports.push({ kind: "star", source: stmt.source.value });
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration;
      if (decl.type === "ClassDeclaration" || decl.type === "ClassExpression") {
        const cls = decl as unknown as OxcClass;
        registerClass(cls);
        if (cls.id !== null) localExports.set("default", cls.id.name);
      }
    }
  }

  return { classes, imports, namespaceImports, localExports, reexports };
}

function reexportPairs(specifiers: readonly ExportSpecifier[]): { imported: string; exported: string }[] {
  return specifiers.map((spec) => ({ imported: moduleExportName(spec.local), exported: moduleExportName(spec.exported) }));
}

/** A `ModuleExportName` (an identifier, or a quoted string in `export { "a-b" as c }`) as plain text. */
function moduleExportName(node: ModuleExportName): string {
  const n = node as unknown as { name?: string; value?: unknown };
  return typeof n.name === "string" ? n.name : typeof n.value === "string" ? n.value : "";
}

/**
 * One declared class's `ClassDecl`, read from its `ɵcmp`/`ɵmod`/`ɵdir` static,
 * whichever (one at most) it has. `ɵɵDirectiveDeclaration` is recorded as
 * `kind: "directive"` and never reported as a component.
 */
function classDeclFrom(node: OxcClass): ClassDecl {
  let kind: ClassDecl["kind"] = "other";
  let selector: string | undefined;
  const inputs: Record<string, string> = {};
  const outputs: Record<string, string> = {};
  let moduleExportRefs: TypeofRef[] = [];

  for (const member of node.body.body) {
    if (member.type !== "PropertyDefinition" || !member.static) continue;
    const keyName = propertyKeyName(member.key);
    if (keyName === undefined) continue;
    const typeRef = member.typeAnnotation?.typeAnnotation;
    if (!typeRef || typeRef.type !== "TSTypeReference") continue;
    const declName =
      typeRef.typeName.type === "TSQualifiedName" ? typeRef.typeName.right.name
      : typeRef.typeName.type === "Identifier" ? typeRef.typeName.name
      : undefined;
    const params = typeRef.typeArguments?.params ?? [];

    if (keyName === "ɵcmp" && declName === "ɵɵComponentDeclaration") {
      kind = "component";
      selector = literalStringOf(params[1]);
      Object.assign(inputs, readAliasMap(params[3]));
      Object.assign(outputs, readStringLiteralMap(params[4]));
    } else if (keyName === "ɵmod" && declName === "ɵɵNgModuleDeclaration") {
      kind = "module";
      moduleExportRefs = readTypeofRefs(params[3]);
    } else if (keyName === "ɵdir" && declName === "ɵɵDirectiveDeclaration") {
      kind = "directive";
      selector = literalStringOf(params[1]);
    }
  }

  return { kind, selector, inputs, outputs, moduleExportRefs };
}

function propertyKeyName(key: OxcPropertyKey): string | undefined {
  if (key.type === "Identifier") return key.name;
  const v = readLiteralValue(key as never);
  return typeof v === "string" ? v : undefined;
}

function literalStringOf(t: TSType | undefined): string | undefined {
  if (t === undefined || t.type !== "TSLiteralType") return undefined;
  const v = readLiteralValue(t.literal as never);
  return typeof v === "string" ? v : undefined;
}

/** `{ "name": { "alias": "..."; "required": false; ... } }` -> property name -> alias (falling back to the name itself when `alias` isn't a readable string literal). */
function readAliasMap(t: TSType | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (t?.type !== "TSTypeLiteral") return out;
  for (const member of t.members) {
    if (member.type !== "TSPropertySignature") continue;
    const name = propertyKeyName(member.key);
    if (name === undefined) continue;
    let alias = name;
    const valueType = member.typeAnnotation?.typeAnnotation;
    if (valueType?.type === "TSTypeLiteral") {
      for (const inner of valueType.members) {
        if (inner.type !== "TSPropertySignature" || propertyKeyName(inner.key) !== "alias") continue;
        const v = literalStringOf(inner.typeAnnotation?.typeAnnotation);
        if (v !== undefined) alias = v;
      }
    }
    out[name] = alias;
  }
  return out;
}

/** `{ "name": "alias" }` (each value a literal string) -> property name -> that string, as Angular emits an `ɵcmp`'s Outputs map. */
function readStringLiteralMap(t: TSType | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (t?.type !== "TSTypeLiteral") return out;
  for (const member of t.members) {
    if (member.type !== "TSPropertySignature") continue;
    const name = propertyKeyName(member.key);
    if (name === undefined) continue;
    const v = literalStringOf(member.typeAnnotation?.typeAnnotation);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/** The `typeof X` / `typeof ns.X` elements of a tuple type, as in an `ɵmod`'s Exports type argument. Anything else (e.g. `never`, when there are none) yields none. */
function readTypeofRefs(t: TSType | undefined): TypeofRef[] {
  if (t?.type !== "TSTupleType") return [];
  const out: TypeofRef[] = [];
  for (const el of t.elementTypes) {
    if (el.type !== "TSTypeQuery") continue;
    const expr: TSTypeQueryExprName = el.exprName;
    if (expr.type === "Identifier") out.push({ kind: "bare", name: expr.name });
    else if (expr.type === "TSQualifiedName" && expr.left.type === "Identifier") {
      out.push({ kind: "qualified", ns: expr.left.name, name: expr.right.name });
    }
  }
  return out;
}
