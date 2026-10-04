// The builder API that parser-react and parser-vue emit through.

import { isAbsolute, relative, resolve } from "node:path";
import type { PropUsage } from "./types/prop-usage.js";
import type { ResolveImport } from "./types/resolve-import.js";
import { posixPath } from "./posix.js";
import type {
  BindingDecl,
  ExportRecord,
  FileGraph,
  Graph,
  ImportRecord,
  InferredType,
  JsxUsage,
  Reference,
  ScopeId,
} from "./index.js";
import { MODULE_SCOPE } from "./index.js";
import type { Dialect, GraphHostHooks, TagUsage } from "./types/file-graph.js";
import type { OccurrenceVia } from "./types/occurrence-via.js";

export interface FileBuilder {
  /** Repo-relative POSIX path of the file this builder is emitting into. */
  readonly filePath: string;
  /**
   * Push a new scope frame. When `key` is given, the scope id is
   * deterministic per key: the first push (or `scopeForNode` call) with that
   * key creates the scope; later pushes re-enter the same id. This is how
   * independent walks over the same AST (value inference vs the declaration
   * walk) agree on a function body's scope id.
   */
  pushScope(key?: string): ScopeId;
  popScope(): void;
  currentScope(): ScopeId;
  /**
   * Get-or-create the scope id for `key` without pushing it on the stack.
   * Used by value inference to stamp refs inside nested function bodies with
   * the same scope id the walker uses when it later pushes that key.
   * `parent` is recorded on first creation only.
   */
  scopeForNode(key: string, parent: ScopeId): ScopeId;
  addImport(record: Omit<ImportRecord, "scope"> & { scope?: ScopeId }): void;
  addDeclaration(decl: Omit<BindingDecl, "scope"> & { scope?: ScopeId }): void;
  addExport(record: ExportRecord): void;
  addJsxUsage(usage: {
    ref: Omit<Reference, "scope"> & { scope?: ScopeId };
    loc: { line: number; column: number };
    props: PropUsage[];
    events?: string[];
  }): void;
  /** Record a Vue tag-based element reference. Pushes a parallel ownership
   *  entry with `kind: "tag"`. */
  addTagUsage(usage: { tagName: string; loc: { line: number; column: number }; props: PropUsage[]; events?: string[] }): void;
  /** Wire the owner of the last-emitted JsxUsage. Optionally override the
   *  `via` the engine emits for this occurrence (see FileGraph.ownership). */
  setOwner(ownerSymbolRef: Reference | null, viaOverride?: OccurrenceVia): void;
  /** Wire the owner of the most-recently-emitted TagUsage. Walks backward
   *  through `ownership` to find the latest `kind: "tag"` entry, so it
   *  remains correct when a TagUsage push is followed by a JsxUsage push
   *  (or vice versa). No-op when no tag-kind ownership entry exists. */
  setTagOwner(ownerSymbolRef: Reference | null, viaOverride?: OccurrenceVia): void;
  /** Same as setOwner but addresses a specific ownership entry by index.
   *  Used by parser-react's prop-forward finalize pass to re-attribute
   *  the original construction-site ownership entry without disturbing later
   *  fan-out duplicates. */
  setOwnerAt(usageIdx: number, ownerSymbolRef: Reference | null, viaOverride?: OccurrenceVia): void;
  /** The count of JsxUsages emitted in this file. A read accessor on an
   *  otherwise write-only builder: parser-react's prop-forward registration
   *  reads it to capture the index of the construction-site JsxUsage emitted
   *  during walkJsxIn. */
  jsxUsageCount(): number;
  /** A shallow copy of the JsxUsage at `idx`, or undefined if out of range.
   *  parser-react's prop-forward finalize pass reads it to clone every usage
   *  in a binding's init range for multi-read fan-out. */
  getJsxUsage(idx: number): { ref: Reference; loc: { line: number; column: number }; props: PropUsage[]; events: string[] } | undefined;
  /** Record an identifier-callee call observed inside a top-level function's
   *  body. See `FileGraph.bodyCalls`. The callee's scope defaults to the
   *  current scope. */
  addBodyCall(record: { ownerSymbol: string; callee: Omit<Reference, "scope"> & { scope?: ScopeId }; args?: InferredType[] }): void;
  /** Record an identifier read in value position. See `FileGraph.heldRefs`.
   *  Scope defaults to the current scope, as for a JSX usage. */
  addHeldRef(ref: Omit<Reference, "scope"> & { scope?: ScopeId }): void;
  /** Record a static member assigned to a name. See `FileGraph.memberAssignments`.
   *  The holder's scope defaults to the current scope; an entry identical to
   *  one already recorded (same holder, member and position) is recorded once. */
  addMemberAssignment(entry: {
    holder: Omit<Reference, "scope"> & { scope?: ScopeId };
    member: string;
    value: InferredType;
    loc: { line: number; column: number };
  }): void;
  /** Record a name whose members the file writes in a form
   *  `addMemberAssignment` does not record. See
   *  `FileGraph.unrecordedMemberWrites`. The scope defaults to the current
   *  scope. */
  addUnrecordedMemberWrite(holder: Omit<Reference, "scope"> & { scope?: ScopeId }): void;
  /** Record that the file exports something `addExport` did not record.
   *  See `FileGraph.unrecordedExports`. */
  markUnrecordedExports(): void;
}

export interface GraphBuilder {
  beginFile(filePath: string, dialect?: Dialect): FileBuilder;
  build(hooks?: GraphHostHooks): Graph;
}

export type CreateGraphBuilderOptions = {
  moduleResolver: ResolveImport;
  /**
   * Optional absolute repo root. When provided, the built Graph gains a
   * `resolveToGraphKey` helper that normalises absolute paths returned by
   * `moduleResolver` into repo-relative POSIX keys matching `Graph.files`.
   */
  repoRoot?: string;
  /** See `Graph.lazyReExportResolution`. Only the bounded definition resolver
   *  sets this; every whole-graph caller leaves it false. */
  lazyReExportResolution?: boolean;
};

export function createGraphBuilder(opts: CreateGraphBuilderOptions): GraphBuilder {
  const files = new Map<string, FileGraph>();

  return {
    beginFile(filePath: string, dialect: Dialect = "react"): FileBuilder {
      const scopes = new Map<ScopeId, { parent: ScopeId | null }>([[MODULE_SCOPE, { parent: null }]]);
      const declarations = new Map<string, BindingDecl>();
      const imports: ImportRecord[] = [];
      const importsByLocal = new Map<string, ImportRecord>();
      const exports: ExportRecord[] = [];
      const jsxUsages: JsxUsage[] = [];
      const tagUsages: TagUsage[] = [];
      const ownership: FileGraph["ownership"] = [];
      const bodyCalls: Array<{ ownerSymbol: string; callee: Reference; args: InferredType[] }> = [];
      const heldRefs: Reference[] = [];
      const memberAssignments: FileGraph["memberAssignments"] = [];
      const memberAssignmentKeys = new Set<string>();
      const unrecordedMemberWrites: Reference[] = [];

      const scopeStack: ScopeId[] = [MODULE_SCOPE];
      let nextScopeId: ScopeId = 1;
      // Deterministic scope ids per AST node key (`fn@<span-start>`): value
      // inference and the declaration walk are independent traversals of the
      // same AST, and refs stamped by one must resolve against declarations
      // registered by the other. First creation (push or scopeForNode) wins;
      // later entries reuse the id.
      const keyedScopes = new Map<string, ScopeId>();

      const fg: FileGraph = { filePath, dialect, scopes, declarations, imports, importsByLocal, exports, jsxUsages, tagUsages, ownership, bodyCalls, heldRefs, memberAssignments, unrecordedMemberWrites };
      files.set(filePath, fg);

      return {
        filePath,
        pushScope(key?: string): ScopeId {
          if (key !== undefined) {
            const existing = keyedScopes.get(key);
            if (existing !== undefined) {
              scopeStack.push(existing);
              return existing;
            }
          }
          const id = nextScopeId++;
          scopes.set(id, { parent: scopeStack[scopeStack.length - 1] ?? null });
          if (key !== undefined) keyedScopes.set(key, id);
          scopeStack.push(id);
          return id;
        },
        scopeForNode(key: string, parent: ScopeId): ScopeId {
          const existing = keyedScopes.get(key);
          if (existing !== undefined) return existing;
          const id = nextScopeId++;
          scopes.set(id, { parent });
          keyedScopes.set(key, id);
          return id;
        },
        popScope(): void {
          if (scopeStack.length <= 1) throw new Error("popScope at module-scope root");
          scopeStack.pop();
        },
        currentScope(): ScopeId {
          return scopeStack[scopeStack.length - 1] ?? MODULE_SCOPE;
        },
        addImport(record): void {
          const scope = record.scope ?? scopeStack[scopeStack.length - 1] ?? MODULE_SCOPE;
          const full: ImportRecord = { ...record, scope };
          imports.push(full);
          // ES modules disallow duplicate local bindings, so each local name
          // appears at most once. Skip the overwrite check.
          importsByLocal.set(full.local, full);
        },
        addDeclaration(decl): void {
          const scope = decl.scope ?? scopeStack[scopeStack.length - 1] ?? MODULE_SCOPE;
          declarations.set(`${scope}::${decl.symbol}`, { ...decl, scope });
        },
        addExport(record): void {
          exports.push(record);
        },
        addJsxUsage(usage): void {
          const scope = usage.ref.scope ?? scopeStack[scopeStack.length - 1] ?? MODULE_SCOPE;
          jsxUsages.push({
            ref: { ...usage.ref, scope },
            loc: usage.loc,
            props: usage.props,
            events: usage.events ?? [],
          });
          ownership.push({ usageIdx: jsxUsages.length - 1, kind: "jsx", ownerSymbolRef: null });
        },
        addTagUsage(usage): void {
          tagUsages.push({ tagName: usage.tagName, loc: usage.loc, props: usage.props, events: usage.events ?? [] });
          ownership.push({ usageIdx: tagUsages.length - 1, kind: "tag", ownerSymbolRef: null });
        },
        setOwner(ownerSymbolRef, viaOverride): void {
          if (ownership.length === 0) return;
          const last = ownership[ownership.length - 1];
          if (last) {
            last.ownerSymbolRef = ownerSymbolRef;
            if (viaOverride !== undefined) {
              last.viaOverride = viaOverride;
            }
          }
        },
        setTagOwner(ownerSymbolRef, viaOverride): void {
          for (let i = ownership.length - 1; i >= 0; i--) {
            const entry = ownership[i];
            if (entry?.kind === "tag") {
              entry.ownerSymbolRef = ownerSymbolRef;
              if (viaOverride !== undefined) entry.viaOverride = viaOverride;
              return;
            }
          }
        },
        setOwnerAt(usageIdx, ownerSymbolRef, viaOverride): void {
          const entry = ownership[usageIdx];
          if (!entry) return;
          entry.ownerSymbolRef = ownerSymbolRef;
          if (viaOverride !== undefined) {
            entry.viaOverride = viaOverride;
          }
        },
        jsxUsageCount(): number {
          return jsxUsages.length;
        },
        getJsxUsage(idx): { ref: Reference; loc: { line: number; column: number }; props: PropUsage[]; events: string[] } | undefined {
          const u = jsxUsages[idx];
          if (!u) return undefined;
          return { ref: { ...u.ref }, loc: { ...u.loc }, props: u.props.slice(), events: u.events?.slice() ?? [] };
        },
        addBodyCall(record): void {
          const scope = record.callee.scope ?? scopeStack[scopeStack.length - 1] ?? MODULE_SCOPE;
          bodyCalls.push({ ownerSymbol: record.ownerSymbol, callee: { ...record.callee, scope }, args: record.args ?? [] });
        },
        addHeldRef(ref): void {
          const scope = ref.scope ?? scopeStack[scopeStack.length - 1] ?? MODULE_SCOPE;
          heldRefs.push({ ...ref, scope });
        },
        addUnrecordedMemberWrite(holder): void {
          const scope = holder.scope ?? scopeStack[scopeStack.length - 1] ?? MODULE_SCOPE;
          unrecordedMemberWrites.push({ ...holder, scope });
        },
        markUnrecordedExports(): void {
          fg.unrecordedExports = true;
        },
        addMemberAssignment(entry): void {
          const scope = entry.holder.scope ?? scopeStack[scopeStack.length - 1] ?? MODULE_SCOPE;
          const key = `${scope}::${entry.holder.symbol}::${entry.member}@${entry.loc.line}:${entry.loc.column}`;
          if (memberAssignmentKeys.has(key)) return;
          memberAssignmentKeys.add(key);
          memberAssignments.push({ ...entry, holder: { ...entry.holder, scope } });
        },
      };
    },
    build(hooks?: GraphHostHooks): Graph {
      const hostHooks: GraphHostHooks = {
        ...(hooks?.firstParty !== undefined ? { firstParty: hooks.firstParty } : {}),
        ...(hooks?.resolveLocalDefinition !== undefined
          ? { resolveLocalDefinition: hooks.resolveLocalDefinition }
          : {}),
        ...(hooks?.isDeclaredDependency !== undefined ? { isDeclaredDependency: hooks.isDeclaredDependency } : {}),
        ...(hooks?.isInstalledPackage !== undefined ? { isInstalledPackage: hooks.isInstalledPackage } : {}),
        ...(hooks?.inInstalledPackage !== undefined ? { inInstalledPackage: hooks.inInstalledPackage } : {}),
      };

      if (opts.repoRoot) {
        const repoRoot = opts.repoRoot;
        const resolveToGraphKey = (absPath: string): string | null => {
          if (!isAbsolute(absPath)) return null;
          const rel = posixPath(relative(repoRoot, absPath));
          // Reject paths that escape the repo root (e.g. node_modules sibling
          // checkouts). Callers fall back to the absolute path; `files.get`
          // returns undefined for both cases. Repo-internal paths return the
          // canonical key regardless of whether the file was parsed into the
          // graph: identity callers need the canonical form even for files
          // excluded by include globs.
          if (rel.startsWith("..")) return null;
          return rel;
        };
        // Graph keys are repoRoot-relative, but the host's moduleResolver
        // anchors relative `from` paths against its own root, which may
        // differ (e.g. the workspace root when scanning a monorepo subdir).
        // Absolutise `from` against the graph's repoRoot before
        // delegating so relative-specifier resolution is anchor-invariant.
        const moduleResolver: ResolveImport = (from, spec) =>
          opts.moduleResolver(isAbsolute(from) ? from : resolve(repoRoot, from), spec);
        return {
          files,
          moduleResolver,
          resolveToGraphKey,
          lazyReExportResolution: opts.lazyReExportResolution ?? false,
          ...hostHooks,
        };
      }
      return {
        files,
        moduleResolver: opts.moduleResolver,
        lazyReExportResolution: opts.lazyReExportResolution ?? false,
        ...hostHooks,
      };
    },
  };
}
