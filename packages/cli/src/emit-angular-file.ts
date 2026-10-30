import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import type { FileBuilder, GraphBuilder, OccurrenceVia } from "@scoutui/reference-graph";
import { MODULE_SCOPE } from "@scoutui/reference-graph";
import {
  createSelectorIndex,
  emitAngularTemplate,
  type AngularCompiler,
  type ElementMatch,
  type SelectorEntry,
  type SelectorIndex,
} from "@scoutui/parser-angular";
import type { DeclaredPropApi } from "@scoutui/scan-format";
import type { AngularComponentDecl, AngularModuleDecl } from "./local-index/detect-angular.js";
import type { LocalDefinition } from "./local-index/types.js";

/** A value import as the graph records it. */
export type AngularImport = { specifier: string; imported: string; local: string };

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
 * The components each Angular file's bootstrap calls start the app with, by the
 * declaring file's graph key: `bootstrapApplication(AppComponent)`, or the
 * `bootstrap` list of the module `bootstrapModule(AppModule)` starts.
 */
export function bootstrappedComponents(calls: readonly AngularBootstrapCall[], files: readonly PendingAngularFile[]): Map<string, Set<string>> {
  const byKey = new Map(files.map((f) => [f.graphKey, f]));
  const fileDeclaring = (fromKey: string, imports: readonly AngularImport[], identifier: string) => {
    const spec = imports.find((i) => i.local === identifier);
    if (spec === undefined) return { file: byKey.get(fromKey), name: identifier };
    if (!spec.specifier.startsWith(".")) return undefined;
    const base = posix.normalize(posix.join(posix.dirname(fromKey), spec.specifier));
    const file = [base, `${base}.ts`, `${base}/index.ts`].map((k) => byKey.get(k)).find((f) => f !== undefined);
    return { file, name: spec.imported };
  };
  const out = new Map<string, Set<string>>();
  const mark = (graphKey: string, className: string) => {
    const set = out.get(graphKey) ?? new Set<string>();
    set.add(className);
    out.set(graphKey, set);
  };
  for (const call of calls) {
    const target = fileDeclaring(call.graphKey, call.imports, call.identifier);
    if (target?.file === undefined) continue;
    if (call.via === "bootstrapApplication") {
      if (target.file.components.some((c) => c.className === target.name)) mark(target.file.graphKey, target.name);
      continue;
    }
    const module = target.file.modules.find((m) => m.className === target.name);
    for (const name of module?.bootstrap ?? []) {
      const declaring = fileDeclaring(target.file.graphKey, target.file.imports, name);
      if (declaring?.file?.components.some((c) => c.className === declaring.name)) mark(declaring.file.graphKey, declaring.name);
    }
  }
  return out;
}

/** Every exported component's selector across the repo. */
export function buildAngularSelectorIndex(compiler: AngularCompiler, files: readonly PendingAngularFile[]): SelectorIndex {
  const components: { selector: string; entry: SelectorEntry }[] = [];
  for (const file of files) {
    for (const c of file.components) {
      if (c.selector === undefined || !c.isExported) continue;
      components.push({
        selector: c.selector,
        entry: { source: { type: "file", graphKey: file.graphKey }, exportName: c.className, inputs: writtenNames(c.inputs), outputs: writtenNames(c.outputs) },
      });
    }
  }
  return createSelectorIndex(compiler, components);
}

/** NgModule scopes across the repo: what each module declares and what it makes available to modules that import it. */
export type AngularModuleScopes = {
  /** The module a non-standalone component is declared in, by class name. */
  declaringModule(className: string): AngularModuleDecl | undefined;
  /** Class names a module exports, following exported modules. */
  exportedBy(moduleName: string): ReadonlySet<string>;
  isModule(className: string): boolean;
};

export function buildModuleScopes(files: readonly PendingAngularFile[]): AngularModuleScopes {
  const modules = new Map<string, AngularModuleDecl>();
  const declaredIn = new Map<string, AngularModuleDecl>();
  for (const file of files) {
    for (const m of file.modules) {
      modules.set(m.className, m);
      for (const d of m.declarations) declaredIn.set(d, m);
    }
  }
  const exported = new Map<string, Set<string>>();
  const exportedBy = (name: string, seen = new Set<string>()): Set<string> => {
    const cached = exported.get(name);
    if (cached !== undefined) return cached;
    const out = new Set<string>();
    if (seen.has(name)) return out;
    seen.add(name);
    for (const e of modules.get(name)?.exports ?? []) {
      if (modules.has(e)) for (const inner of exportedBy(e, seen)) out.add(inner);
      else out.add(e);
    }
    exported.set(name, out);
    return out;
  };
  return { declaringModule: (c) => declaredIn.get(c), exportedBy: (m) => exportedBy(m), isModule: (c) => modules.has(c) };
}

/**
 * The class names a component's template can use, or null when the scan can't
 * tell and every selector in the repo is a candidate. A standalone component
 * sees what its `imports` list (and the exports of modules listed there); a
 * component declared in an NgModule sees that module's declarations and the
 * exports of the modules it imports.
 */
function templateScope(c: AngularComponentDecl, scopes: AngularModuleScopes): ReadonlySet<string> | null {
  const visible = new Set<string>();
  const addImports = (imports: readonly string[]) => {
    for (const name of imports) {
      if (scopes.isModule(name)) for (const e of scopes.exportedBy(name)) visible.add(e);
      else visible.add(name);
    }
  };
  if (c.standalone) {
    if (c.imports.length === 0) return null;
    addImports(c.imports);
    visible.add(c.className);
    return visible;
  }
  const module = scopes.declaringModule(c.className);
  if (module === undefined) return null;
  for (const d of module.declarations) visible.add(d);
  addImports(module.imports);
  return visible;
}

function relativeSpecifier(fromGraphKey: string, toGraphKey: string): string {
  const rel = posix.relative(posix.dirname(fromGraphKey), toGraphKey).replace(/\.[cm]?tsx?$/, "");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

const entryLabel = (entry: SelectorEntry) =>
  `${entry.source.type === "file" ? entry.source.graphKey : entry.source.specifier}#${entry.exportName}`;

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
  onAmbiguous: (diagnostic: { filePath: string; line: number; column: number; tagName: string; candidates: string[] }) => void;
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
    const template = readTemplate(c, file);
    if (template === undefined) continue;
    let builder = fileBuilder;
    if (template.graphKey !== file.graphKey) {
      builder = opts.templateBuilders.get(template.graphKey) ?? opts.graphBuilder.beginFile(template.graphKey, "angular");
      opts.templateBuilders.set(template.graphKey, builder);
    }
    const scope = templateScope(c, opts.scopes);
    emitAngularTemplate({
      compiler,
      template: template.source,
      templateUrl: template.graphKey,
      origin: template.origin,
      fileBuilder: builder,
      owner: { symbol: c.className, scope: MODULE_SCOPE, memberChain: [], loc: c.loc, originFile: file.graphKey },
      index,
      inScope: (entry) => scope === null || scope.has(entry.exportName),
      resolveLocal,
      onTemplateError: (message) => opts.onTemplateError(template.graphKey, message),
      onAmbiguous: (tagName, loc, matches: readonly ElementMatch[]) =>
        opts.onAmbiguous({ filePath: template.graphKey, line: loc.line, column: loc.column, tagName, candidates: matches.map((m) => entryLabel(m.entry)) }),
    });
  }
}

function readTemplate(c: AngularComponentDecl, file: PendingAngularFile): { source: string; graphKey: string; origin: { line: number; column: number } } | undefined {
  if (c.template === undefined) return undefined;
  if (c.template.kind === "inline") {
    return { source: c.template.source, graphKey: file.graphKey, origin: { line: c.template.line, column: c.template.column } };
  }
  try {
    const source = readFileSync(join(dirname(file.absPath), c.template.url), "utf8");
    return { source, graphKey: posix.normalize(posix.join(posix.dirname(file.graphKey), c.template.url)), origin: { line: 1, column: 1 } };
  } catch {
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
