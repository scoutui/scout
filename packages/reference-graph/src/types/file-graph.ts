import type { PropUsage } from "./prop-usage.js";
import type { ResolveImport } from "./resolve-import.js";
import type { InferredType } from "./inferred-type.js";
import type { OccurrenceVia } from "./occurrence-via.js";
import type { Reference, ScopeId } from "./reference.js";

/** A binding declared in a file (variable, function, class, import alias). */
export type BindingDecl = {
  scope: ScopeId;
  symbol: string;
  value: InferredType;
  loc: { line: number; column: number };
  isExported: boolean;
  /** When `export { local as exported }`, the public name differs from the local. */
  exportedAs?: string;
};

export type ImportRecord = {
  specifier: string;
  /** `"default"` | exported name | `"*"` (namespace). */
  imported: string;
  local: string;
  scope: ScopeId;
  loc: { line: number; column: number };
};

export type ExportRecord =
  | { kind: "named"; exportedAs: string; local: string }
  | {
      kind: "named";
      exportedAs: string;
      from: string;
      /** `"default"` | exported name | `"*"` (namespace: `export * as exportedAs from`). */
      fromImported: string;
    }
  | { kind: "star"; from: string }
  | { kind: "default"; local: string };

/** A JSX element opening. Becomes one or more Occurrences post-resolution. */
export type JsxUsage = {
  ref: Reference;
  loc: { line: number; column: number };
  /** Per-occurrence prop usage extracted at parse time. */
  props: PropUsage[];
  /** Event names bound at this usage (Vue native events). */
  events?: string[];
};

/** A tag-based element reference: a Vue template tag with no script binding
 *  (`FileGraph.tagUsages`), or a React JSX custom element, which the engine
 *  reads off its `JsxUsage`.
 *  Parallel to JsxUsage but keyed by tag name rather than identifier Reference. */
export type TagUsage = {
  /** The tag as written: lowercased in a Vue template, as authored
   *  in JSX. Kebab-fallback for PascalCase Vue tags (`<VBtn>` → `vbtn`) is
   *  the parser's job, not the engine's. */
  tagName: string;
  loc: { line: number; column: number };
  props: PropUsage[];
  /** Event names bound at this usage (Vue native events). */
  events?: string[];
};

/** Source-file dialect understood by the engine. Drives the default
 *  identity kind for occurrences whose resolution doesn't find a concrete
 *  manifest entry. */
export type Dialect = "react" | "vue";

/** Discriminator for shared `ownership[i]` entries: whether the entry
 *  references a `jsxUsages[i]` (symbol-resolved) or `tagUsages[i]`
 *  (tag-name-resolved) emission. */
export type UsageKind = "jsx" | "tag";

export type FileGraph = {
  /** Repo-relative POSIX path. */
  filePath: string;
  /** Dialect of the source file. Controls the default identity kind for
   *  occurrences whose resolution doesn't find a concrete manifest entry. */
  dialect: Dialect;
  scopes: Map<ScopeId, { parent: ScopeId | null }>;
  /** Keyed by `${scopeId}::${symbol}` for O(1) scope-aware lookup. */
  declarations: Map<string, BindingDecl>;
  imports: ImportRecord[];
  /** Index of `imports[]` keyed by `local`, for O(1) lookup on engine hot
   *  paths. Populated by the builder's `addImport` in lockstep with
   *  `imports[]`. */
  importsByLocal: Map<string, ImportRecord>;
  exports: ExportRecord[];
  jsxUsages: JsxUsage[];
  /** Tag-based usages (Vue auto-imports). Indexed
   *  by ownership entries whose `kind === "tag"`. Empty for files whose
   *  parser doesn't emit tag-shaped references (e.g. parser-react). */
  tagUsages: TagUsage[];
  /** Per-usage owner attribution. `usageIdx` aligns with either
   *  `jsxUsages[i]` or `tagUsages[i]` depending on `kind`. Both usage
   *  arrays share this single ownership stream so the engine can iterate
   *  attribution in emission order regardless of usage shape.
   *
   *  `viaOverride` is optionally set by the parser when it has pre-decided
   *  the occurrence's `via` (e.g. parser-react's prop-forward path for
   *  module-scope JSX bindings). When present, the engine uses
   *  this as the occurrence's `via` and the first element of `viaChain`,
   *  bypassing its algebra-derived computation for this specific usage. */
  ownership: Array<{
    usageIdx: number;
    /** Which usage array `usageIdx` indexes into. */
    kind: UsageKind;
    ownerSymbolRef: Reference | null;
    viaOverride?: OccurrenceVia;
  }>;
  /** Identifier-callee CallExpressions observed inside the body of a top-level
   *  function declaration. Each entry records `{ ownerSymbol, callee }` where
   *  `ownerSymbol` is the enclosing top-level function's symbol and `callee`
   *  is a Reference to the called symbol.
   *
   *  Used by buildHelperCallers (engine/helper-callers.ts) to detect a
   *  component's call to a helper-shaped function when the call appears in
   *  the body rather than in the return-type expression, as in
   *  `const opts = useFoo(); return <X/>`.
   *
   *  Recorded only for direct calls inside the top-level function's lexical
   *  body (not nested arrow/function expressions). Identifier callees only:
   *  member expressions (`a.b()`) and complex callees are skipped. Parsers
   *  other than parser-react may emit an empty array. The
   *  callee is a reference in the enclosing function's scope, so a body-local
   *  function shadowing a module-scope helper is the callee.
   *
   *  `args` is the call's argument list by position: an identifier argument
   *  is a `TypeOf` reference in the enclosing function's scope (so a
   *  body-local declaration shadowing a module-scope name resolves to the
   *  local), anything else is `Unknown`. The engine's hook argument seeding
   *  reads it; `buildHelperCallers` ignores it.
   */
  bodyCalls: Array<{ ownerSymbol: string; callee: Reference; args: InferredType[] }>;
  /** Identifiers read in value position: a call argument, an object property
   *  value, an array element, an assignment right-hand side, a return value,
   *  a JSX attribute or child expression. Holding a declaration is using it:
   *  the component registry (engine/registry.ts) treats every held reference
   *  as consumption, beside exports and JSX usages, so a component the code
   *  names anywhere gets its row even when nothing renders it directly.
   *
   *  Not a callee, not a member-access object or property, not a declaration
   *  name, pattern, property key, import/export specifier or JSX tag name.
   *  The parser records only names React could render as a component
   *  (`isHostElementName` rejects the rest). A held reference carries no via,
   *  owner or identity: it is never an occurrence. Parsers other than
   *  parser-react may emit an empty array. */
  heldRefs: Reference[];
  /** Static members assigned to a name: `X.m = v` where `X` is an identifier
   *  (single level only; `A.b.c = v` is not recorded), and each property of
   *  an object literal after the first argument of a declarator's
   *  `Object.assign(A0, …)`. `holder` is the name at the assignment's scope.
   *  Parsers other than parser-react may emit an empty array. */
  memberAssignments: Array<{ holder: Reference; member: string; value: InferredType; loc: { line: number; column: number } }>;
  /** Names whose members the file writes in a form `memberAssignments` does
   *  not record: a cast or computed or nested write (`(X as any).m = v`,
   *  `X[k] = v`, `X.a.b = v`), an `Object.assign(X, …)`, a class's static
   *  members. The holder is the name at the write's scope. Parsers other than
   *  parser-react may emit an empty array. */
  unrecordedMemberWrites: Reference[];
  /** Set when the file exports something `exports` does not record (an
   *  anonymous `export default { … }`, a CommonJS assignment, a Vue SFC
   *  script's named export), so a name missing from `exports` is not provably
   *  absent. */
  unrecordedExports?: true;
};

export type Graph = {
  files: Map<string, FileGraph>;
  moduleResolver: ResolveImport;
  /**
   * Normalises an absolute path into the repo-relative POSIX key format used
   * by `files`. Returns `null` for paths outside the repo root or for inputs
   * that aren't absolute. Returns the rel-path for any in-repo file regardless
   * of whether that file was parsed into the graph: identity stamping relies
   * on the canonical form even for files excluded by include globs (e.g. a
   * relative import targeting a barrel file outside the scan scope).
   */
  resolveToGraphKey?: (absPath: string) => string | null;
  /**
   * When true, this graph is parsed lazily, on demand (the bounded definition
   * resolver's shadow graph): a caller parses files one at a time and re-walks.
   * Signals `followReExportChain` to return an advance terminal keyed on a
   * resolved-but-not-yet-parsed re-export target so that caller's parse-and-retry
   * loop can reach it. Defaults false: a complete graph treats a not-in-graph
   * re-export target as out-of-scope and keeps the barrel terminal, so a rewrap
   * never fabricates a synthetic "default"/node_modules identity. Not inferable
   * from `resolveToGraphKey`: complete graphs are routinely built without a
   * `repoRoot`.
   */
  lazyReExportResolution?: boolean;
  /**
   * First-party seam. When a resolved absolute import target is not in
   * `files`, a `true` return means the target is first-party (a workspace
   * member or the root package's own source) and the import names an
   * unparsed local file, pinned through `resolveLocalDefinition`, whatever
   * the specifier's shape. Otherwise a package specifier, or a target inside
   * an installed package (`inInstalledPackage`), names a package export and
   * any other specifier a failed import. Wired by the host at `build()` time
   * (CLI wires `isFirstPartyPath`).
   */
  firstParty?: (absPath: string) => boolean;
  /**
   * Identity pinning for unparsed first-party files (bounded re-export resolution).
   * Maps (resolved entry file, imported name) → definition file + canonical
   * export name so a member's identity is scope-invariant between whole-repo
   * and single-app scans. Absolute in, absolute out. Null → callers fall
   * back to the resolved entry file itself. The answer's `path` is the member
   * path left past its `exportName`: a namespace re-export on the way consumes
   * segments of the `path` asked. Absent → the `path` asked. `definition` is
   * where the pinned export, followed down that path, is declared in
   * `absFile` (`declarationPositionIn`), when the host locates it. When the
   * chain leaves first-party code through a package import, the answer is
   * that package export instead: the `specifier` it names, the `exportName`
   * imported from it and the absolute `fromFile` the import is written in.
   */
  resolveLocalDefinition?: (
    absPath: string,
    imported: string,
    path: readonly string[],
  ) =>
    | { absFile: string; exportName: string; path?: readonly string[]; definition?: { line: number; column: number } }
    | { fromFile: string; specifier: string; exportName: string; path?: readonly string[] }
    | null;
  /**
   * Host answer for a bare package import whose module did not resolve:
   * whether the importing file's package declares the package. Graph keys
   * in. Absent → the import is treated as installed (engine-only callers).
   */
  isDeclaredDependency?: (fromFile: string, packageName: string) => boolean;
  /**
   * Host answer, asked with `isDeclaredDependency`: whether the package is
   * installed where `fromFile` looks for it. An installed package whose
   * module did not resolve keeps the written-package identity. Graph keys
   * in. Absent → not installed.
   */
  isInstalledPackage?: (fromFile: string, packageName: string) => boolean;
  /**
   * Host answer for a resolved import target that is neither in `files` nor
   * first-party: whether the file lies inside a package installed where
   * `fromFile` looks for it. Such a target names a package export whatever
   * the specifier's shape. Graph key and absolute path in. Absent → not
   * installed.
   */
  inInstalledPackage?: (fromFile: string, absPath: string) => boolean;
};

/**
 * Host hooks attached to the Graph at `build()` time, not when the builder is
 * created: the CLI constructs the graph builder in its Phase 1, but the
 * bounded definition resolver, which backs `resolveLocalDefinition`, only
 * exists by resolve time.
 */
export type GraphHostHooks = Pick<
  Graph,
  "firstParty" | "resolveLocalDefinition" | "isDeclaredDependency" | "isInstalledPackage" | "inInstalledPackage"
>;
