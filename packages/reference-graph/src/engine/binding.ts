import type { Known, UnresolvedReason } from "@scoutui/scan-format";
import type { BindingDecl, ExportRecord, FileGraph, Graph, ImportRecord, InferredType, Reference, ScopeId } from "../index.js";
import { MODULE_SCOPE } from "../index.js";
import { createCycleGuard, type CycleGuard } from "./cycle-detection.js";
import { libraryStubFor } from "./library-stubs.js";
import { compoundExportName, effectiveExportName, residualMemberChain } from "./member-identity.js";
import { packageNameFromSpecifier } from "./specifier.js";
import type { TerminalIdentity } from "./wrapper-folding.js";

/** A static member recorded on a declaration (`FileGraph.memberAssignments`). */
export type StaticMember = { name: string; value: InferredType; loc: { line: number; column: number } };

/** What a name refers to. `path` is the member chain past the binding. A
 *  declaration's `member` is set when the name is a recorded static member of
 *  `decl` (`Card.Header = X`). A package export's `fromFile` is the file whose
 *  import names the package, and `resolved` whether that import's module
 *  resolved. An `unparsed` binding names a first-party file the scan did not
 *  parse by its resolved absolute path, not pinned to its definition
 *  (`pinUnparsed`); once pinned, `definition` is where the host located its
 *  declaration. */
export type Binding =
  | {
      kind: "declaration";
      file: string;
      decl: BindingDecl;
      member: StaticMember | null;
      path: readonly string[];
      inScope: boolean;
    }
  | {
      kind: "package-export";
      specifier: string;
      exportName: string;
      path: readonly string[];
      stub: InferredType | null;
      fromFile: string;
      resolved: boolean;
    }
  | {
      kind: "unparsed";
      file: string;
      exportName: string;
      path: readonly string[];
      definition?: { line: number; column: number };
    }
  | { kind: "unbound" }
  | { kind: "import-failed"; specifier: string; exportName: string; path: readonly string[] }
  | { kind: "no-export" }
  | { kind: "unfollowed" };

const NO_EXPORT: Binding = { kind: "no-export" };
const UNFOLLOWED: Binding = { kind: "unfollowed" };
const UNBOUND: Binding = { kind: "unbound" };

/** A module target: a parsed file's graph key, or the binding for a target
 *  the graph does not hold. */
type Target = { kind: "parsed"; key: string } | { kind: "outside"; binding: Binding };

/**
 * Walk the scope chain for `ref.symbol` in `fileGraph.declarations` and
 * return the first matching BindingDecl, or null if not found.
 */
export function findLocalDeclaration(fileGraph: FileGraph, ref: Reference): BindingDecl | null {
  let scope: ScopeId = ref.scope;
  while (true) {
    const decl = fileGraph.declarations.get(`${scope}::${ref.symbol}`);
    if (decl) return decl;
    if (scope === MODULE_SCOPE) return null;
    const parent = fileGraph.scopes.get(scope)?.parent;
    if (parent === null || parent === undefined) return null;
    scope = parent;
  }
}

/**
 * Pick the FileGraph a Reference should be resolved against. When
 * `ref.originFile` is set, prefer that file's graph; this is how refs that
 * have travelled across a module boundary get looked up in their authoring
 * context. Falls back to the caller's `fileGraph` when no annotation is
 * present (synthetic refs / parsers without ref-origin tagging).
 */
export function fileGraphForRef(graph: Graph, ref: Reference, fallback: FileGraph): FileGraph {
  if (!ref.originFile || ref.originFile === fallback.filePath) return fallback;
  return graph.files.get(ref.originFile) ?? fallback;
}

/** The graph key for an absolute path; null when it lies outside the repo root. */
export function graphKeyFor(graph: Graph, abs: string): string | null {
  return graph.resolveToGraphKey ? graph.resolveToGraphKey(abs) : abs;
}

/** The file's own named export `name`, or its default export for `"default"`. */
export function exportRecordFor(fileGraph: FileGraph, name: string): ExportRecord | undefined {
  return fileGraph.exports.find(
    (e) => (e.kind === "named" && e.exportedAs === name) || (e.kind === "default" && name === "default"),
  );
}

/** Whether `symbol` is the file's default export: an `export default` of a
 *  local, or the anonymous declaration the parser names `default`. */
export function isDefaultExport(fileGraph: FileGraph, symbol: string): boolean {
  return symbol === "default" || fileGraph.exports.some((e) => e.kind === "default" && e.local === symbol);
}

/** The import record, as written, that the resolver reads `ref` through: the
 *  import of `ref`'s own file (`fileGraphForRef`) under its name, unless a
 *  declaration in the scope chain binds the name first. */
export function bindingImport(graph: Graph, fileGraph: FileGraph, ref: Reference): ImportRecord | undefined {
  const own = fileGraphForRef(graph, ref, fileGraph);
  return findLocalDeclaration(own, ref) === null ? own.importsByLocal.get(ref.symbol) : undefined;
}

/** The binding `ref` names: its scope chain, then its file's imports. A
 *  declaration's recorded static member consumes the first member segment. */
export function resolveBinding(
  graph: Graph,
  fileGraph: FileGraph,
  ref: Reference,
  guard: CycleGuard = createCycleGuard(),
): Binding {
  return bindingIn(graph, fileGraphForRef(graph, ref, fileGraph), ref, guard, new Set());
}

const writtenDeclarationIndex = new WeakMap<Graph, ReadonlySet<BindingDecl>>();

/** The declarations some member write in the graph names as its holder,
 *  through the binding: every `memberAssignments` holder, in any scope, and
 *  every `unrecordedMemberWrites` holder. Built once per graph. */
export function memberWrittenDeclarations(graph: Graph): ReadonlySet<BindingDecl> {
  const cached = writtenDeclarationIndex.get(graph);
  if (cached) return cached;
  const written = new Set<BindingDecl>();
  for (const fileGraph of graph.files.values()) {
    const holders = [...fileGraph.memberAssignments.map((write) => write.holder), ...fileGraph.unrecordedMemberWrites];
    for (const holder of holders) {
      const binding = resolveBinding(graph, fileGraph, holder);
      if (binding.kind === "declaration") written.add(binding.decl);
    }
  }
  writtenDeclarationIndex.set(graph, written);
  return written;
}

/** The reference a static member access `X.m` names when `m` is a recorded
 *  static member of the declaration `X` names: `X`'s reference extended by
 *  `m`. Null for any other access. */
export function staticMemberReference(
  graph: Graph,
  fileGraph: FileGraph,
  obj: InferredType,
  member: string,
  guard?: CycleGuard,
): Reference | null {
  if (obj.kind !== "TypeOf") return null;
  const ref: Reference = { ...obj.ref, memberChain: [...obj.ref.memberChain, member] };
  const binding = resolveBinding(graph, fileGraph, ref, guard);
  return binding.kind === "declaration" && binding.member !== null && binding.path.length === 0 ? ref : null;
}

/** The binding `import { imported } from specifier` names in `fromFile`,
 *  with `memberChain` the members accessed on the import. */
export function resolveModuleExport(
  graph: Graph,
  fromFile: string,
  specifier: string,
  imported: string,
  memberChain: readonly string[],
  guard: CycleGuard = createCycleGuard(),
): Binding {
  return moduleExport(graph, fromFile, specifier, imported, memberChain, guard, new Set());
}

/** `sought` holds every `file::name` the resolution has sought an export
 *  record for (`findExportRecord`). */
function bindingIn(graph: Graph, fileGraph: FileGraph, ref: Reference, guard: CycleGuard, sought: Set<string>): Binding {
  const decl = findLocalDeclaration(fileGraph, ref);
  if (decl) {
    const [first, ...rest] = ref.memberChain;
    const member = first === undefined ? undefined : staticMembers(fileGraph).get(decl)?.get(first);
    return member === undefined
      ? { kind: "declaration", file: fileGraph.filePath, decl, member: null, path: ref.memberChain, inScope: true }
      : { kind: "declaration", file: fileGraph.filePath, decl, member, path: rest, inScope: true };
  }
  const imp = fileGraph.importsByLocal.get(ref.symbol);
  if (!imp) return UNBOUND;
  const stub = libraryStubFor(imp, ref);
  if (stub) {
    return {
      kind: "package-export",
      specifier: imp.specifier,
      exportName: effectiveExportName(imp.imported, ref.memberChain),
      path: residualMemberChain(imp.imported, ref.memberChain),
      stub,
      fromFile: fileGraph.filePath,
      resolved: true,
    };
  }
  return moduleExport(graph, fileGraph.filePath, imp.specifier, imp.imported, ref.memberChain, guard, sought);
}

const staticMemberIndex = new WeakMap<FileGraph, Map<BindingDecl, Map<string, StaticMember>>>();

/** The file's recorded static members by the declaration each holder names
 *  (`findLocalDeclaration` at the assignment's scope), built once per file.
 *  Only an assignment made in the scope the holder is declared in counts; one
 *  made from another function's body is ignored. A member assigned more than
 *  once there keeps the last assignment in source order. */
function staticMembers(fileGraph: FileGraph): Map<BindingDecl, Map<string, StaticMember>> {
  const cached = staticMemberIndex.get(fileGraph);
  if (cached) return cached;
  const index = new Map<BindingDecl, Map<string, StaticMember>>();
  for (const { holder, member, value, loc } of fileGraph.memberAssignments) {
    const decl = findLocalDeclaration(fileGraph, holder);
    if (!decl || decl.scope !== holder.scope) continue;
    let members = index.get(decl);
    if (!members) {
      members = new Map();
      index.set(decl, members);
    }
    members.set(member, { name: member, value, loc });
  }
  staticMemberIndex.set(fileGraph, index);
  return index;
}

function moduleExport(
  graph: Graph,
  fromFile: string,
  specifier: string,
  imported: string,
  memberChain: readonly string[],
  guard: CycleGuard,
  sought: Set<string>,
): Binding {
  const exportName = effectiveExportName(imported, memberChain);
  const path = residualMemberChain(imported, memberChain);
  const target = moduleTarget(graph, fromFile, specifier, exportName, path);
  if (target.kind === "outside") return target.binding;
  if (imported === "*" && memberChain.length === 0) return UNFOLLOWED;
  return exportIn(graph, target.key, exportName, path, guard, sought);
}

/** Classify the module `specifier` resolves to from `fromFile`: a parsed
 *  file is followed; a first-party file the graph does not hold is
 *  `unparsed`, whatever the specifier's shape. Anything else, resolved or
 *  not, is a package export for a specifier that names a valid package and a
 *  failed import for any other. */
function moduleTarget(
  graph: Graph,
  fromFile: string,
  specifier: string,
  exportName: string,
  path: readonly string[],
): Target {
  const abs = graph.moduleResolver(fromFile, specifier);
  if (abs) {
    const key = graphKeyFor(graph, abs) ?? abs;
    if (graph.files.has(key)) return { kind: "parsed", key };
    if (graph.firstParty?.(abs) === true) {
      return { kind: "outside", binding: { kind: "unparsed", file: abs, exportName, path } };
    }
  }
  const binding: Binding =
    packageNameFromSpecifier(specifier) !== null
      ? { kind: "package-export", specifier, exportName, path, stub: null, fromFile, resolved: abs !== null }
      : { kind: "import-failed", specifier, exportName, path };
  return { kind: "outside", binding };
}

/** The binding the export `name` of parsed `file` names. */
function exportIn(
  graph: Graph,
  file: string,
  name: string,
  path: readonly string[],
  guard: CycleGuard,
  sought: Set<string>,
): Binding {
  const found = findExportRecord(graph, file, name, sought);
  if (!found) return starExport(graph, file, name, path);
  return bindingForRecord(graph, found.fileGraph, found.record, name, path, guard, sought);
}

/** The export record `name` finds in `file`: its own, else the first
 *  `export *` target in source order that finds one. A target whose
 *  `file::name` the resolution has already sought is skipped, and every
 *  `file::name` sought is recorded in `sought`. */
function findExportRecord(
  graph: Graph,
  file: string,
  name: string,
  sought: Set<string>,
): { record: ExportRecord; fileGraph: FileGraph } | null {
  sought.add(`${file}::${name}`);
  const fileGraph = graph.files.get(file);
  if (!fileGraph) return null;
  const record = exportRecordFor(fileGraph, name);
  if (record) return { record, fileGraph };
  for (const star of fileGraph.exports) {
    if (star.kind !== "star") continue;
    const abs = graph.moduleResolver(file, star.from);
    if (!abs) continue;
    const next = graphKeyFor(graph, abs);
    if (next === null || sought.has(`${next}::${name}`)) continue;
    const found = findExportRecord(graph, next, name, sought);
    if (found) return found;
  }
  return null;
}

/** What `name` binds through `export *`, for a name no parsed branch exports,
 *  from the `export *` targets outside the graph, collected through `file`'s
 *  parsed `export *` targets: the package export when there is exactly one
 *  and it is a package; `no-export` when there are none, and always for
 *  `default`, which `export *` never re-exports, unless a file searched
 *  exports something it does not record (`unrecordedExports`), which makes
 *  it `unfollowed`; else `unfollowed`. */
function starExport(graph: Graph, file: string, name: string, path: readonly string[]): Binding {
  if (name === "default") return graph.files.get(file)?.unrecordedExports ? UNFOLLOWED : NO_EXPORT;
  const seen = new Set<string>();
  const outside: Binding[] = [];
  let unrecorded = false;
  const visit = (f: string): void => {
    if (seen.has(f)) return;
    seen.add(f);
    const fileGraph = graph.files.get(f);
    if (!fileGraph) return;
    if (fileGraph.unrecordedExports) unrecorded = true;
    for (const star of fileGraph.exports) {
      if (star.kind !== "star") continue;
      const target = moduleTarget(graph, f, star.from, name, path);
      if (target.kind === "parsed") visit(target.key);
      else outside.push(target.binding);
    }
  };
  visit(file);
  if (outside.length === 0) return unrecorded ? UNFOLLOWED : NO_EXPORT;
  return outside.length === 1 && outside[0]?.kind === "package-export" ? outside[0] : UNFOLLOWED;
}

/** The binding export record `exp` of `fg` names: an exported local is
 *  resolved in `fg`, an `export … from` hop in its target, and a namespace
 *  re-export (`export * as NS from`) as `import * as NS` from its target. */
function bindingForRecord(
  graph: Graph,
  fg: FileGraph,
  exp: ExportRecord,
  name: string,
  path: readonly string[],
  guard: CycleGuard,
  sought: Set<string>,
): Binding {
  if (exp.kind === "star") return NO_EXPORT;
  if ("local" in exp) {
    if (guard.push(fg.filePath, exp.local) !== "ok") return UNFOLLOWED;
    try {
      const ref: Reference = { symbol: exp.local, scope: MODULE_SCOPE, memberChain: [...path], loc: { line: 0, column: 0 } };
      const b = bindingIn(graph, fg, ref, guard, sought);
      return b.kind === "declaration" ? { ...b, inScope: false } : b;
    } finally {
      guard.pop(fg.filePath, exp.local);
    }
  }
  if (exp.fromImported === "*") return moduleExport(graph, fg.filePath, exp.from, "*", path, guard, sought);
  const target = moduleTarget(graph, fg.filePath, exp.from, exp.fromImported, path);
  if (target.kind === "outside") return target.binding;
  const found = findExportRecord(graph, target.key, exp.fromImported, sought);
  if (!found) return starExport(graph, target.key, exp.fromImported, path);
  if (guard.push(fg.filePath, exp.exportedAs) !== "ok") return UNFOLLOWED;
  try {
    return bindingForRecord(graph, found.fileGraph, found.record, exp.fromImported, path, guard, sought);
  } finally {
    guard.pop(fg.filePath, exp.exportedAs);
  }
}

/** The value a binding names: a declaration's value, or its static member's,
 *  wrapped in `MemberOf` per `path` segment; a package export's library stub;
 *  else `Unknown`. */
export function bindingValue(binding: Binding): InferredType {
  switch (binding.kind) {
    case "declaration": {
      let value = binding.member?.value ?? binding.decl.value;
      for (const member of binding.path) value = { kind: "MemberOf", obj: value, member };
      return value;
    }
    case "package-export":
      return binding.stub ?? { kind: "Unknown" };
    default:
      return { kind: "Unknown" };
  }
}

/** The declaration a binding names, or reads a static member of (the
 *  holder), with the file it is declared in; null for any other binding. */
export function bindingDeclaration(binding: Binding): { file: string; decl: BindingDecl } | null {
  return binding.kind === "declaration" ? { file: binding.file, decl: binding.decl } : null;
}

/** The identity a binding names: a declaration or an unparsed file is
 *  local (a static member under `Holder.member`), a package export is the
 *  import as written, and anything else names nothing. Only a declaration
 *  that is not a member and has nothing left on its path carries the
 *  declaration; a pinned unparsed file carries its `definition`. */
export function bindingIdentity(
  binding: Extract<Binding, { kind: "declaration" }>,
): Extract<TerminalIdentity, { kind: "local" }>;
export function bindingIdentity(binding: Binding): TerminalIdentity;
export function bindingIdentity(binding: Binding): TerminalIdentity {
  switch (binding.kind) {
    case "declaration": {
      const name = binding.member === null ? binding.decl.symbol : `${binding.decl.symbol}.${binding.member.name}`;
      return {
        kind: "local",
        filePath: binding.file,
        export: compoundExportName(name, binding.path),
        ...(binding.member === null && binding.path.length === 0 ? { declaration: binding.decl } : {}),
      };
    }
    case "unparsed":
      return {
        kind: "local",
        filePath: binding.file,
        export: compoundExportName(binding.exportName, binding.path),
        ...(binding.definition !== undefined ? { definition: binding.definition } : {}),
      };
    case "package-export":
      return {
        kind: "imported",
        specifier: binding.specifier,
        imported: compoundExportName(binding.exportName, binding.path),
      };
    default:
      return null;
  }
}

/** An `unparsed` binding pinned to the definition the host's
 *  `resolveLocalDefinition` finds for it, with the declaration position the
 *  host located; the resolved file when the host finds none. When the host
 *  finds that it leaves first-party code through a package import, it is
 *  that package export. Any other binding is returned unchanged. */
export function pinUnparsed<B extends Binding>(
  graph: Graph,
  binding: B,
): B | Extract<Binding, { kind: "package-export" }> {
  if (binding.kind !== "unparsed") return binding;
  const def = graph.resolveLocalDefinition?.(binding.file, binding.exportName, binding.path) ?? null;
  if (def === null) return binding;
  if ("specifier" in def) {
    return {
      kind: "package-export",
      specifier: def.specifier,
      exportName: def.exportName,
      path: binding.path,
      stub: null,
      fromFile: graphKeyFor(graph, def.fromFile) ?? def.fromFile,
      resolved: true,
    };
  }
  return {
    ...binding,
    file: def.absFile,
    exportName: def.exportName,
    ...(def.definition !== undefined ? { definition: def.definition } : {}),
  };
}

/** Where a declaration binding is declared: its static member's assignment,
 *  else its declaration. */
export function declarationPosition(binding: Extract<Binding, { kind: "declaration" }>): {
  line: number;
  column: number;
} {
  const at = binding.member?.loc ?? binding.decl.loc;
  return { line: at.line, column: at.column };
}

/** Where the module-scope name `symbol` of parsed `file`, followed down
 *  `path`, is declared in that file (`declarationPosition`); undefined when
 *  it names no declaration there. */
export function declarationPositionIn(
  graph: Graph,
  file: string,
  symbol: string,
  path: readonly string[],
): { line: number; column: number } | undefined {
  const fileGraph = graph.files.get(file);
  if (fileGraph === undefined) return undefined;
  const ref: Reference = { symbol, scope: MODULE_SCOPE, memberChain: [...path], loc: { line: 0, column: 0 } };
  const binding = resolveBinding(graph, fileGraph, ref);
  return binding.kind === "declaration" && binding.file === file ? declarationPosition(binding) : undefined;
}

/**
 * The decision for a package export whose module did not resolve: why it
 * names no component. Null when it names its written package: the module
 * resolved, the host does not answer (`isDeclaredDependency` absent), or the
 * package is installed (`isInstalledPackage`). Otherwise
 * `package-not-installed` when the importing file's package declares it,
 * else `module-not-found`. The render path and `walkedIdentity` ask it.
 */
export function unresolvedPackageExport(
  graph: Graph,
  binding: Extract<Binding, { kind: "package-export" }>,
): Known<UnresolvedReason> | null {
  const declared = graph.isDeclaredDependency;
  const packageName = packageNameFromSpecifier(binding.specifier);
  if (binding.resolved || declared === undefined || packageName === null) return null;
  if (graph.isInstalledPackage?.(binding.fromFile, packageName) === true) return null;
  return declared(binding.fromFile, packageName) ? { kind: "package-not-installed", packageName } : { kind: "module-not-found" };
}

/** The identity a walk credits for a binding: `bindingIdentity`, with an
 *  unparsed file pinned (`pinUnparsed`) and a package export carrying the
 *  reason it names no component (`unresolvedPackageExport`). */
export function walkedIdentity(graph: Graph, binding: Binding): TerminalIdentity {
  const identity = bindingIdentity(pinUnparsed(graph, binding));
  if (binding.kind !== "package-export" || identity?.kind !== "imported") return identity;
  const unresolved = unresolvedPackageExport(graph, binding);
  return unresolved === null ? identity : { ...identity, unresolved };
}
