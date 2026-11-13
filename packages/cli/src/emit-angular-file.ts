import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import type { FileBuilder, GraphBuilder, OccurrenceVia } from "@scoutui/reference-graph";
import { MODULE_SCOPE } from "@scoutui/reference-graph";
import {
  createSelectorIndex,
  emitAngularTemplate,
  type AngularCompiler,
  type DirectiveSelector,
  type ElementMatch,
  type SelectorEntry,
  type SelectorIndex,
} from "@scoutui/parser-angular";
import type { DeclaredPropApi } from "@scoutui/scan-format";
import type { AngularConstArray, AngularComponentDecl, AngularModuleDecl } from "./local-index/detect-angular.js";
import type { AngularLibraryIndex } from "./scan/angular-library-index.js";
import type { LocalDefinition } from "./local-index/types.js";
import { errorMessage } from "./util/errors.js";

/** A value import as the graph records it. */
export type AngularImport = { specifier: string; imported: string; local: string };

/**
 * What the scan read of each parsed script, so a `const` array of imports
 * (`export const ExampleButtonImports = [ExampleButton]`) can be followed to its
 * members, and a name an import lands on can be told apart from a class that
 * isn't a component (a directive or pipe).
 */
export type AngularScripts = ReadonlyMap<
  string,
  {
    /** The imports this file's const arrays name their members through. */
    imports: readonly AngularImport[];
    arrays: ReadonlyMap<string, AngularConstArray>;
    /** Every class declared at the top level. */
    classes: ReadonlySet<string>;
    /** Sources of its `export * from` lines. */
    stars: readonly string[];
  }
>;

/** One parsed Angular file, held until every file's selectors are known: a template names its components by selector, not by import. */
export type PendingAngularFile = {
  /** configDir-relative POSIX path: the graph key. */
  graphKey: string;
  /** outputRoot-relative POSIX path: where local definitions and seeds place the file. */
  definitionPath: string;
  absPath: string;
  components: AngularComponentDecl[];
  modules: AngularModuleDecl[];
  imports: AngularImport[];
};

/** Loads `@angular/compiler` the way the scanned repo would, or null when it isn't installed there. */
export function loadAngularCompiler(configDir: string): AngularCompiler | null {
  try {
    return createRequire(join(configDir, "package.json"))("@angular/compiler") as AngularCompiler;
  } catch {
    return null;
  }
}

/** Template-facing names: an input or output's alias when it has one. */
const writtenNames = (members: readonly { name: string; alias?: string }[]) => members.map((m) => m.alias ?? m.name);

/** Local definitions for the components a file declares, each one's inputs as its declared props. */
export function angularDefinitions(
  components: readonly AngularComponentDecl[],
  definitionPath: string,
  bootstrapped: ReadonlySet<string> = new Set(),
): LocalDefinition[] {
  return components.map((c) => {
    const props: DeclaredPropApi["props"] = {};
    for (const input of c.inputs) props[input.alias ?? input.name] = input.required ? { required: true } : {};
    return {
      componentId: { kind: "angular-component", export: c.className, source: { type: "local", filePath: definitionPath } },
      exportName: c.className,
      isDefault: c.isDefault,
      detector: "angular-component",
      loc: { file: definitionPath, line: c.loc.line, column: c.loc.column },
      declared: { props, hasRest: false },
      ...(bootstrapped.has(c.className) ? { isBootstrapped: true } : {}),
    };
  });
}

/** A bootstrap call: the class it starts the app with, and the file making the call. */
export type AngularBootstrapCall = { graphKey: string; identifier: string; via: "bootstrapApplication" | "bootstrapModule"; imports: readonly AngularImport[] };

/**
 * Resolves `identifier` as written in the file whose graph key is
 * `fromGraphKey` (with value imports `fromImports`) to the file that
 * actually declares it, and the name it has there: itself when nothing in
 * `fromImports` names it (a same-file class), the relative import's target
 * file when one does, or `undefined` when the import is relative but its
 * target isn't one of this scan's pending Angular files, or a bare/package
 * specifier (a library import — this only resolves within the repo).
 */
/**
 * Where an import written in a repo file points: the graph key of the repo file
 * that declares the imported name and the name it's declared under, or null
 * when it leaves the repo (an installed package). The scan backs it with the
 * same resolution React uses: tsconfig `paths` and other aliases, and
 * re-exports followed to the declaring file.
 */
export type AngularRefResolver = (fromGraphKey: string, specifier: string, imported: string) => { graphKey: string; name: string } | null;

/** Relative imports only, without following re-exports: what a caller without the scan's resolver gets. */
const relativeOnly =
  (byKey: ReadonlyMap<string, PendingAngularFile>): AngularRefResolver =>
  (fromGraphKey, specifier, imported) => {
    if (!specifier.startsWith(".")) return null;
    const base = posix.normalize(posix.join(posix.dirname(fromGraphKey), specifier));
    const graphKey = [base, `${base}.ts`, `${base}/index.ts`].find((k) => byKey.has(k));
    return graphKey === undefined ? { graphKey: base, name: imported } : { graphKey, name: imported };
  };

function resolveRepoRef(
  fromGraphKey: string,
  fromImports: readonly AngularImport[],
  identifier: string,
  byKey: ReadonlyMap<string, PendingAngularFile>,
  resolver: AngularRefResolver,
): { file: PendingAngularFile | undefined; name: string } | undefined {
  const spec = fromImports.find((i) => i.local === identifier);
  if (spec === undefined) return { file: byKey.get(fromGraphKey), name: identifier };
  const target = resolver(fromGraphKey, spec.specifier, spec.imported);
  if (target === null) return undefined;
  return { file: byKey.get(target.graphKey), name: target.name };
}

/**
 * The components each Angular file's bootstrap calls start the app with, by the
 * declaring file's graph key: `bootstrapApplication(AppComponent)`, or the
 * `bootstrap` list of the module `bootstrapModule(AppModule)` starts.
 */
export function bootstrappedComponents(
  calls: readonly AngularBootstrapCall[],
  files: readonly PendingAngularFile[],
  resolver?: AngularRefResolver,
): Map<string, Set<string>> {
  const byKey = new Map(files.map((f) => [f.graphKey, f]));
  const resolve = resolver ?? relativeOnly(byKey);
  const out = new Map<string, Set<string>>();
  const mark = (graphKey: string, className: string) => {
    const set = out.get(graphKey) ?? new Set<string>();
    set.add(className);
    out.set(graphKey, set);
  };
  for (const call of calls) {
    const target = resolveRepoRef(call.graphKey, call.imports, call.identifier, byKey, resolve);
    if (target?.file === undefined) continue;
    if (call.via === "bootstrapApplication") {
      if (target.file.components.some((c) => c.className === target.name)) mark(target.file.graphKey, target.name);
      continue;
    }
    const module = target.file.modules.find((m) => m.className === target.name);
    for (const name of module?.bootstrap ?? []) {
      const declaring = resolveRepoRef(target.file.graphKey, target.file.imports, name, byKey, resolve);
      if (declaring?.file?.components.some((c) => c.className === declaring.name)) mark(declaring.file.graphKey, declaring.name);
    }
  }
  return out;
}

/**
 * Every exported component's selector across the repo, and those of the
 * installed libraries its Angular files import. A selector
 * `compiler.CssSelector.parse` can't read (invalid CSS) is skipped — rather
 * than failing the whole index, which would stop every framework's scan —
 * and reported through `onSelectorUnreadable`, so one bad selector costs
 * only its own component's uses, not every component's.
 */
export function buildAngularSelectorIndex(
  compiler: AngularCompiler,
  files: readonly PendingAngularFile[],
  library?: AngularLibraryIndex,
  onSelectorUnreadable?: (filePath: string, className: string, selector: string, message: string) => void,
): SelectorIndex {
  const components: { selector: string; entry: SelectorEntry }[] = [];
  const directives: DirectiveSelector[] = [];
  for (const d of library?.directives ?? []) {
    // A name starting with `ɵ` is a library's private API by Angular's convention (NG-ZORRO's
    // `ɵNzTransitionPatchDirective`, which its public modules bring along): it still claims the elements it names, but
    // isn't counted.
    if (d.exportName.startsWith("ɵ")) {
      directives.push(d.selector);
      continue;
    }
    directives.push({
      selector: d.selector,
      entry: { source: { type: "package", specifier: d.specifier }, exportName: d.exportName, declaredAs: d.declaredAs, inputs: d.inputs, outputs: d.outputs },
    });
  }
  for (const c of library?.components ?? []) {
    components.push({
      selector: c.selector,
      entry: { source: { type: "package", specifier: c.specifier }, exportName: c.exportName, declaredAs: c.declaredAs, inputs: c.inputs, outputs: c.outputs },
    });
  }
  for (const file of files) {
    for (const c of file.components) {
      if (c.selector === undefined || !c.isExported) continue;
      try {
        compiler.CssSelector.parse(c.selector);
      } catch (err) {
        onSelectorUnreadable?.(file.graphKey, c.className, c.selector, errorMessage(err));
        continue;
      }
      const entry: SelectorEntry = { source: { type: "file", graphKey: file.graphKey }, exportName: c.className, inputs: writtenNames(c.inputs), outputs: writtenNames(c.outputs) };
      if (c.kind === "directive") directives.push({ selector: c.selector, entry });
      else components.push({ selector: c.selector, entry });
    }
  }
  return createSelectorIndex(compiler, components, directives);
}

/**
 * NgModule scopes across the repo: what each module declares and what it
 * makes available to modules that import it. Every key this type deals in is
 * file-qualified — `${graphKey}#${className}` for a repo declaration, or the
 * bare specifier name for a library import (there's no library index yet, so
 * those still pass through by name, same as before this type existed) —
 * never a bare class name, so two files that each declare a class of the same
 * name (two apps in a monorepo each with their own `AppModule`) never
 * collide.
 */
export type AngularModuleScopes = {
  /** The module declaring a non-standalone component, keyed by the component's own `${graphKey}#${className}`, plus the file it's declared in — its own `declarations`/`imports` are written there, not necessarily in the component's file. */
  declaringModule(componentKey: string): { module: AngularModuleDecl; file: PendingAngularFile } | undefined;
  /** Keys a module (keyed by its own `${graphKey}#${className}`) makes available to modules that import it, following exported modules. Null when that can't be fully determined — an incomplete `exports` list somewhere in the chain — and every selector should be treated as a candidate instead of trusting a partial list. */
  exportedBy(moduleKey: string): ReadonlySet<string> | null;
  isModule(key: string): boolean;
  /** Resolves an identifier written in `fromFile` to a stable key: `${graphKey}#${name}` for a repo file (through relative paths, aliases and re-exports), the bare name for an installed package, or undefined when a repo target isn't one of this scan's Angular files. */
  resolveRef(fromFile: PendingAngularFile, identifier: string): string | undefined;
  /**
   * The keys an `imports` entry written in `fromFile` stands for: `resolveRef`'s key for a class or module, every member of a const array
   * (followed through spreads, nested arrays and other files), nothing for a repo class that is neither component nor module (a directive or pipe).
   * `complete` is false when part of it can't be read. `packages` holds the specifier of every installed-package import it reached,
   * however deep in a const array, so the scan can index those libraries before it matches templates.
   */
  resolveImports(fromFile: PendingAngularFile, identifier: string): { keys: string[]; complete: boolean; packages: string[] };
};

export function buildModuleScopes(
  files: readonly PendingAngularFile[],
  resolver?: AngularRefResolver,
  library?: AngularLibraryIndex,
  scripts?: AngularScripts,
): AngularModuleScopes {
  const byKey = new Map(files.map((f) => [f.graphKey, f]));
  const resolve = resolver ?? relativeOnly(byKey);
  // An installed library's NgModules, by the name they're exported under: what each makes available, by name.
  const libraryModules = new Map((library?.modules ?? []).map((m) => [m.exportName, m.exports.map((e) => e.exportName)]));
  // Every class an installed entry exports, by `${specifier}#${exportName}`. Without an index (no compiler, or a caller
  // that has none) a package import counts as read, as before.
  const libraryClasses = library === undefined ? undefined : new Set(library.classes.map((c) => `${c.specifier}#${c.exportName}`));

  const resolveRef = (fromFile: PendingAngularFile, identifier: string): string | undefined => {
    const spec = fromFile.imports.find((i) => i.local === identifier);
    // An installed package's components and modules are matched by name.
    if (spec !== undefined && resolve(fromFile.graphKey, spec.specifier, spec.imported) === null) return spec.imported;
    const target = resolveRepoRef(fromFile.graphKey, fromFile.imports, identifier, byKey, resolve);
    return target?.file === undefined ? undefined : `${target.file.graphKey}#${target.name}`;
  };

  const resolveImports = (fromFile: PendingAngularFile, identifier: string): { keys: string[]; complete: boolean; packages: string[] } => {
    const keys: string[] = [];
    const packages: string[] = [];
    let complete = true;
    const seen = new Set<string>();
    // True once `name` in `graphKey` is accounted for: a key it adds, a const array it expands, or a class that isn't a component or module.
    const follow = (graphKey: string, imports: readonly AngularImport[], name: string): boolean => {
      const spec = imports.find((i) => i.local === name);
      let at = { graphKey, name };
      if (spec !== undefined) {
        const target = resolve(graphKey, spec.specifier, spec.imported);
        // An installed package's export is matched by name. It counts as read only when the library index knows it
        // as a class the package exports: anything else (a `const` array of imports in its typings, or a package the
        // index didn't reach) may stand for components the scope can't see.
        if (target === null) {
          packages.push(spec.specifier);
          if (libraryClasses !== undefined && !libraryClasses.has(`${spec.specifier}#${spec.imported}`)) return false;
          keys.push(spec.imported);
          return true;
        }
        at = target;
      }
      const id = `${at.graphKey}#${at.name}`;
      if (seen.has(id)) return true;
      seen.add(id);
      const script = scripts?.get(at.graphKey);
      const array = script?.arrays.get(at.name);
      if (array !== undefined) {
        if (!array.complete) complete = false;
        for (const member of array.members) if (!follow(at.graphKey, script?.imports ?? [], member)) complete = false;
        return true;
      }
      const declaring = byKey.get(at.graphKey);
      if (declaring?.components.some((c) => c.className === at.name) || declaring?.modules.some((m) => m.className === at.name)) {
        keys.push(id);
        return true;
      }
      if (script?.classes.has(at.name)) return true;
      // A barrel that only re-exports: look for the name in what it re-exports.
      for (const star of script?.stars ?? []) {
        const next = resolve(at.graphKey, star, at.name);
        if (next !== null && follow(next.graphKey, [], next.name)) return true;
      }
      return false;
    };
    if (!follow(fromFile.graphKey, fromFile.imports, identifier)) complete = false;
    return { keys, complete, packages };
  };

  type ModuleEntry = { module: AngularModuleDecl; file: PendingAngularFile };
  const modules = new Map<string, ModuleEntry>();
  const declaredIn = new Map<string, ModuleEntry>();
  for (const file of files) {
    for (const m of file.modules) {
      const entry: ModuleEntry = { module: m, file };
      modules.set(`${file.graphKey}#${m.className}`, entry);
      for (const d of m.declarations) {
        const key = resolveRef(file, d);
        if (key !== undefined) declaredIn.set(key, entry);
      }
    }
  }

  const exportedCache = new Map<string, ReadonlySet<string> | null>();
  const exportedBy = (moduleKey: string, seen = new Set<string>()): ReadonlySet<string> | null => {
    const cached = exportedCache.get(moduleKey);
    if (cached !== undefined) return cached;
    if (seen.has(moduleKey)) return new Set<string>(); // cycle guard: not cached, same as before this type was keyed
    seen.add(moduleKey);
    const libraryExports = libraryModules.get(moduleKey);
    if (libraryExports !== undefined) {
      // A library module's exports are named by the library's own typings; one that's itself a module adds what it exports.
      const out = new Set<string>();
      for (const name of libraryExports) {
        if (libraryModules.has(name)) for (const n of exportedBy(name, seen) ?? []) out.add(n);
        else out.add(name);
      }
      exportedCache.set(moduleKey, out);
      return out;
    }
    const entry = modules.get(moduleKey);
    if (entry === undefined || !entry.module.exportsComplete) {
      exportedCache.set(moduleKey, null);
      return null;
    }
    const out = new Set<string>();
    for (const name of entry.module.exports) {
      const key = resolveRef(entry.file, name);
      if (key === undefined) continue;
      if (modules.has(key) || libraryModules.has(key)) {
        const inner = exportedBy(key, seen);
        if (inner === null) {
          exportedCache.set(moduleKey, null);
          return null;
        }
        for (const n of inner) out.add(n);
      } else {
        out.add(key);
      }
    }
    exportedCache.set(moduleKey, out);
    return out;
  };

  return {
    declaringModule: (key) => declaredIn.get(key),
    exportedBy,
    isModule: (key) => modules.has(key) || libraryModules.has(key),
    resolveRef,
    resolveImports,
  };
}

/**
 * The file-qualified keys a component's template can use. A standalone
 * component sees what its `imports` list names (and the exports of modules
 * listed there); a component declared in an NgModule sees that module's
 * declarations and the exports of the modules it imports.
 *
 * `complete` is false when part of that can't be read (an `imports`,
 * `declarations` or `exports` list with an entry that isn't a plain name, or a
 * name no file in the repo declares). `visible` then holds only what could be read,
 * and an element nothing in it matches may still come from the part that
 * couldn't, so it is matched against every component in the repo instead.
 * A standalone component with an empty `imports` list is treated as unreadable
 * too: the scan can't tell it from a component whose list was lost.
 */
function templateScope(c: AngularComponentDecl, file: PendingAngularFile, scopes: AngularModuleScopes): { visible: ReadonlySet<string>; complete: boolean } {
  const visible = new Set<string>();
  let complete = true;
  const addImports = (fromFile: PendingAngularFile, names: readonly string[]) => {
    for (const name of names) {
      const resolved = scopes.resolveImports(fromFile, name);
      if (!resolved.complete) complete = false;
      for (const key of resolved.keys) {
        if (scopes.isModule(key)) {
          const exported = scopes.exportedBy(key);
          if (exported === null) {
            complete = false;
            continue;
          }
          for (const e of exported) visible.add(e);
        } else {
          visible.add(key);
        }
      }
    }
  };

  if (c.standalone) {
    addImports(file, c.imports);
    visible.add(`${file.graphKey}#${c.className}`);
    return { visible, complete: complete && c.importsComplete && c.imports.length > 0 };
  }

  const found = scopes.declaringModule(`${file.graphKey}#${c.className}`);
  if (found === undefined) return { visible, complete: false };
  const { module, file: moduleFile } = found;
  if (!module.declarationsComplete || !module.importsComplete) complete = false;
  for (const d of module.declarations) {
    const key = scopes.resolveRef(moduleFile, d);
    if (key === undefined) {
      complete = false;
      continue;
    }
    visible.add(key);
  }
  addImports(moduleFile, module.imports);
  return { visible, complete };
}

function relativeSpecifier(fromGraphKey: string, toGraphKey: string): string {
  const rel = posix.relative(posix.dirname(fromGraphKey), toGraphKey).replace(/\.[cm]?tsx?$/, "");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

const entryLabel = (entry: SelectorEntry) =>
  `${entry.source.type === "file" ? entry.source.graphKey : entry.source.specifier}#${entry.exportName}`;

/**
 * Picks the entry to report for one library class reached through several entry points or export names.
 * First the entry this file imports by name, then any entry from a specifier this file imports from, then the
 * rest. Within a rank, the name the class is declared under wins, then the label, so an unrelated import from
 * the same package (such as `provideIcons` next to `NgIcon`) can't change which name is reported.
 */
export function chooseLibraryEntry(group: readonly ElementMatch[], imports: readonly AngularImport[]): ElementMatch {
  const rank = (m: ElementMatch) => {
    const src = m.entry.source;
    if (src.type !== "package") return 3;
    const fromHere = imports.filter((i) => i.specifier === src.specifier);
    if (fromHere.some((i) => i.imported === m.entry.exportName)) return 0;
    return fromHere.length > 0 ? 1 : 2;
  };
  const isDeclaredName = (m: ElementMatch) => Number(m.entry.declaredAs?.className === m.entry.exportName);
  const sorted = [...group].sort(
    (a, b) => rank(a) - rank(b) || isDeclaredName(b) - isDeclaredName(a) || entryLabel(a.entry).localeCompare(entryLabel(b.entry)),
  );
  return sorted[0] as ElementMatch;
}

/**
 * Emits one Angular file into the graph: its component classes as components,
 * and each component's template elements as uses it owns. An inline template's
 * uses are recorded in the `.ts` file; a `templateUrl` template's in its own
 * file, so a use's location is where the element is written.
 */
export function emitAngularFile(opts: {
  graphBuilder: GraphBuilder;
  /** Null when the repo doesn't install `@angular/compiler`: the components are declared, their templates skipped. */
  compiler: AngularCompiler | null;
  index: SelectorIndex | undefined;
  scopes: AngularModuleScopes;
  file: PendingAngularFile;
  /** Builders of `.html` templates already begun, by graph key, so a template two components share is one file. */
  templateBuilders: Map<string, FileBuilder>;
  onTemplateError: (filePath: string, message: string) => void;
  /** Called when a component's `templateUrl` file can't be read, instead of throwing: the component's own `.ts` file and the `templateUrl` as written. */
  onTemplateMissing?: (filePath: string, templateUrl: string) => void;
  onAmbiguous: (diagnostic: { filePath: string; line: number; column: number; tagName: string; candidates: string[] }) => void;
  /** An element only components outside the template's scope match: in a repo that builds, a sign the scope reading missed something. */
  onOutOfScope?: (diagnostic: { filePath: string; line: number; column: number; tagName: string; candidates: string[] }) => void;
}): void {
  const { file } = opts;
  const fileBuilder = opts.graphBuilder.beginFile(file.graphKey, "angular");
  for (const spec of file.imports) {
    fileBuilder.addImport({ specifier: spec.specifier, imported: spec.imported, local: spec.local, loc: { line: 1, column: 1 } });
  }
  for (const c of file.components) {
    fileBuilder.addDeclaration({ symbol: c.className, value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: c.loc, isExported: c.isExported });
    if (!c.isExported) continue;
    fileBuilder.addExport(c.isDefault ? { kind: "default", local: c.className } : { kind: "named", exportedAs: c.className, local: c.className });
  }

  // The local name each matched component is reached by in this file, so a
  // component imported nowhere gets one synthetic import however often it's used.
  const locals = new Map<string, { local: string; via?: OccurrenceVia }>();
  const takenLocals = new Set([...file.imports.map((i) => i.local), ...file.components.map((c) => c.className)]);
  const resolveLocal = (entry: SelectorEntry, loc: { line: number; column: number }) => {
    const key = entryLabel(entry);
    const known = locals.get(key);
    if (known !== undefined) return known;
    let resolved: { local: string; via?: OccurrenceVia };
    if (entry.source.type === "file" && entry.source.graphKey === file.graphKey) {
      resolved = { local: entry.exportName };
    } else {
      const imported = file.imports.find((i) => i.imported === entry.exportName);
      if (imported !== undefined) {
        resolved = { local: imported.local, via: { kind: "angular-template", specifier: imported.specifier, import: imported.imported } };
      } else {
        // No import names it here: record the import Angular resolves the
        // selector through, from the file (or package) that declares it.
        const specifier = entry.source.type === "file" ? relativeSpecifier(file.graphKey, entry.source.graphKey) : entry.source.specifier;
        let local = entry.exportName;
        for (let n = 2; takenLocals.has(local); n++) local = `${entry.exportName}$${n}`;
        takenLocals.add(local);
        fileBuilder.addImport({ specifier, imported: entry.exportName, local, loc });
        resolved = { local, via: { kind: "angular-template", specifier, import: entry.exportName } };
      }
    }
    locals.set(key, resolved);
    return resolved;
  };

  const { compiler, index } = opts;
  if (compiler === null || index === undefined) return;
  for (const c of file.components) {
    const template = readTemplate(c, file, opts.onTemplateMissing);
    if (template === undefined) continue;
    let builder = fileBuilder;
    if (template.graphKey !== file.graphKey) {
      builder = opts.templateBuilders.get(template.graphKey) ?? opts.graphBuilder.beginFile(template.graphKey, "angular");
      opts.templateBuilders.set(template.graphKey, builder);
    }
    const { visible, complete } = templateScope(c, file, opts.scopes);
    emitAngularTemplate({
      compiler,
      template: template.source,
      templateUrl: template.graphKey,
      origin: template.origin,
      fileBuilder: builder,
      owner: { symbol: c.className, scope: MODULE_SCOPE, memberChain: [], loc: c.loc, originFile: file.graphKey },
      index,
      // Repo entries compare by their file-qualified key, same as the scope
      // set holds them; a package entry still matches by name alone (no
      // library index yet to qualify it with).
      inScope: (entry) => visible.has(entry.source.type === "file" ? `${entry.source.graphKey}#${entry.exportName}` : entry.exportName),
      // An element nothing readable matches may come from what the scan couldn't read: it falls back to every component in the repo.
      scopeIsPartial: !complete,
      resolveLocal,
      onTemplateError: (message) => opts.onTemplateError(template.graphKey, message),
      chooseEntry: (group) => chooseLibraryEntry(group, file.imports),
      onAmbiguous: (tagName, loc, matches: readonly ElementMatch[]) =>
        opts.onAmbiguous({ filePath: template.graphKey, line: loc.line, column: loc.column, tagName, candidates: matches.map((m) => entryLabel(m.entry)) }),
      onOutOfScope: (tagName, loc, matches: readonly ElementMatch[]) =>
        opts.onOutOfScope?.({ filePath: template.graphKey, line: loc.line, column: loc.column, tagName, candidates: matches.map((m) => entryLabel(m.entry)) }),
    });
  }
}

function readTemplate(
  c: AngularComponentDecl,
  file: PendingAngularFile,
  onTemplateMissing?: (filePath: string, templateUrl: string) => void,
): { source: string; graphKey: string; origin: { line: number; column: number } } | undefined {
  if (c.template === undefined) return undefined;
  if (c.template.kind === "inline") {
    return { source: c.template.source, graphKey: file.graphKey, origin: { line: c.template.line, column: c.template.column } };
  }
  try {
    const source = readFileSync(join(dirname(file.absPath), c.template.url), "utf8");
    return { source, graphKey: posix.normalize(posix.join(posix.dirname(file.graphKey), c.template.url)), origin: { line: 1, column: 1 } };
  } catch {
    onTemplateMissing?.(file.graphKey, c.template.url);
    return undefined;
  }
}

/** The value imports an oxc program declares. Type-only imports are left out: they never reach a template. */
export function importsOf(program: { body: readonly unknown[] }): AngularImport[] {
  type Specifier = { type: string; importKind?: string; imported?: { name?: string; value?: string }; local: { name: string } };
  type Statement = { type: string; importKind?: string; source?: { value: string }; specifiers?: Specifier[] };
  const out: AngularImport[] = [];
  for (const stmt of program.body as Statement[]) {
    if (stmt.type !== "ImportDeclaration" || stmt.importKind === "type" || stmt.source === undefined) continue;
    for (const spec of stmt.specifiers ?? []) {
      if (spec.importKind === "type") continue;
      const imported =
        spec.type === "ImportDefaultSpecifier" ? "default"
        : spec.type === "ImportNamespaceSpecifier" ? "*"
        : (spec.imported?.name ?? spec.imported?.value ?? spec.local.name);
      out.push({ specifier: stmt.source.value, imported, local: spec.local.name });
    }
  }
  return out;
}
