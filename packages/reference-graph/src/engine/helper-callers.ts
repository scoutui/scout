import type { BindingDecl, FileGraph, Graph, InferredType, Reference } from "../index.js";
import { MODULE_SCOPE } from "../index.js";
import { bindingDeclaration, isDefaultExport, resolveBinding } from "./binding.js";
import { createCycleGuard } from "./cycle-detection.js";
import { ownershipOf } from "./owner-resolution.js";
import type { ComponentRegistry } from "./registry.js";

export type Classification = "component" | "helper" | "unknown";

/**
 * Component-vs-helper classification for owner attribution: owners
 * are registry members, or they fan out. A Function- or call-valued
 * declaration the registry admits is a "component" and owns its JSX; one it
 * does not admit is a "helper", and the JSX inside it belongs to its callers
 * (`resolveOwnerChain`). Plain values stay "unknown".
 *
 * There is no shape test or naming rule here: `registry` is the roster view
 * (`excludeHostElementNames` applied), so a lowercase render helper, a
 * capitalised function only ever called (`ActionButtons({…})`), and a dead
 * JSX-returning declaration are all helpers for the same reason: the
 * registry did not admit them.
 *
 * A Vue SFC (the default-exported declaration of a vue-dialect file) is
 * outside the registry by design (it is not typed by this algebra) and the
 * engine admits its identity unconditionally; ownership follows the same
 * rule, so an SFC always owns its template. Any other declaration in a Vue
 * file (a `<script>` helper) is judged like a React one.
 */
export function classifyDeclaration(decl: BindingDecl, registry: ComponentRegistry, fileGraph: FileGraph): Classification {
  if (decl.value.kind !== "Function" && decl.value.kind !== "ReturnTypeOf") return "unknown";
  if (fileGraph.dialect === "vue" && isDefaultExport(fileGraph, decl.symbol)) return "component";
  return registry.hasLocal(fileGraph.filePath, decl.symbol) ? "component" : "helper";
}

export type SymbolKey = { file: string; symbol: string };

export type HelperCallerIndex = {
  get(key: SymbolKey): Set<SymbolKey> | undefined;
};

export type ClassifiedHelperIndex = HelperCallerIndex & {
  classification(file: string, symbol: string): Classification;
};

/**
 * Three-phase build of the helper → component-callers reverse index plus
 * per-decl classification cache.
 *
 * Phase 1 (collect) walks every module-scope `Function`- or
 * `ReturnTypeOf`-valued BindingDecl across the graph (the latter is a
 * factory's product), collecting caller-side references from
 * three sources:
 *
 *   1. `TypeOf` refs inside the decl's return-type expressions
 *      (`decl.value.returns`): captures `() => helper()` shapes where the
 *      call participates in the function's value flow.
 *   2. `fileGraph.bodyCalls` entries whose `ownerSymbol` matches the decl:
 *      captures `() => { const x = helper(); return <X/> }` shapes where
 *      the call is a body-level statement, invisible to the value-flow
 *      algebra. parser-react populates these; other parsers may emit an
 *      empty array.
 *   3. `fileGraph.jsxUsages` whose target resolves to a helper-classified
 *      declaration: captures `<Helper/>` invocation, which is a call shape
 *      the value-flow + bodyCalls passes don't see. The JSX's enclosing
 *      scope (its ownership entry's `ownerSymbolRef`) is the caller.
 *
 * Phase 2 (classify) runs classification on every module-scope Function- or
 * ReturnTypeOf-valued decl.
 *
 * Phase 3 (index) walks the pending value-refs and JSX-calls collected in
 * phase 1, recording caller edges for targets classified as `"helper"`. Each
 * collected ref's root name resolves through the binding resolver
 * (`resolveBinding`) in the ref's own scope; a ref that names anything but a
 * module-scope declaration (a package export, an unparsed file, nothing, or a
 * body-local declaration) records no edge.
 *
 * Cost: O(declarations × refs-per-declaration + jsx-usages). No new IO.
 */
export function buildHelperCallers(graph: Graph, registry: ComponentRegistry): ClassifiedHelperIndex {
  // ── Phase 1: collect ────────────────────────────────────────────────────
  // Per-target accumulators (file::symbol → ...). callerKeysByHelper dedupes
  // caller edges in O(1).
  const index = new Map<string, Set<SymbolKey>>();
  const callerKeysByHelper = new Map<string, Set<string>>();

  // Per-decl classification cache populated in phase 2.
  const classificationCache = new Map<string, Classification>();
  const refResolutionCache = new Map<string, { file: string; decl: BindingDecl } | null>();
  const guard = createCycleGuard();

  function resolveRefCached(
    ref: Reference,
    callerFile: string,
    callerGraph: FileGraph,
  ): { file: string; decl: BindingDecl } | null {
    const key = `${callerFile}::${ref.scope}::${ref.symbol}`;
    if (refResolutionCache.has(key)) {
      return refResolutionCache.get(key) ?? null;
    }
    const result = bindingDeclaration(resolveBinding(graph, callerGraph, { ...ref, memberChain: [] }, guard));
    refResolutionCache.set(key, result);
    return result;
  }

  // Pass A: walk every Function-valued decl, collect value-ref edges.
  type PendingValueRef = {
    target: { file: string; decl: BindingDecl };
    caller: SymbolKey;
  };
  const pendingValueRefs: PendingValueRef[] = [];

  for (const [file, fileGraph] of graph.files) {
    for (const decl of fileGraph.declarations.values()) {
      if (decl.scope !== MODULE_SCOPE) continue;
      const refs: Reference[] = [];
      if (decl.value.kind === "Function") {
        for (const r of decl.value.returns) collectRefsInType(r, refs);
      } else if (decl.value.kind === "ReturnTypeOf") {
        // A factory's product (`const Foo = withLoading(FooView)`) is a
        // caller of the factory, so JSX inside the factory's body
        // fans out to each product. Only the callee chain contributes: an
        // argument is the thing being wrapped, not a value the product
        // consumes. Restricted to `ReturnTypeOf` because the rule is about
        // the product of a call. A bare alias (`const Item = RadioArea`,
        // `TypeOf`) or a member alias (`const Root = Primitive.Root`,
        // `MemberOf`) is not a call: running `collectCalleeRefs` on those
        // would index the alias as a caller of what it aliases and fan its
        // JSX out to the alias instead of leaving it owned by the original
        // declaration.
        collectCalleeRefs(decl.value, refs);
      }
      for (const bc of fileGraph.bodyCalls) {
        if (bc.ownerSymbol === decl.symbol) refs.push(bc.callee);
      }
      const callerKey: SymbolKey = { file, symbol: decl.symbol };

      for (const ref of refs) {
        const target = resolveRefCached(ref, file, fileGraph);
        if (!target || target.decl.scope !== MODULE_SCOPE) continue;
        pendingValueRefs.push({ target, caller: callerKey });
      }
    }
  }

  // Pass B: walk every JSX usage and collect helper JSX-as-call caller
  // edges. The JSX's enclosing scope is the caller.
  type PendingJsxCall = {
    target: { file: string; decl: BindingDecl };
    caller: SymbolKey;
  };
  const pendingJsxCalls: PendingJsxCall[] = [];

  for (const [file, fileGraph] of graph.files) {
    for (let i = 0; i < fileGraph.jsxUsages.length; i++) {
      const usage = fileGraph.jsxUsages[i];
      if (!usage) continue;
      const target = resolveRefCached(usage.ref, file, fileGraph);
      if (!target || target.decl.scope !== MODULE_SCOPE) continue;

      const ownership = ownershipOf(fileGraph, "jsx", i);
      if (!ownership?.ownerSymbolRef) continue;
      const callerTarget = resolveRefCached(ownership.ownerSymbolRef, file, fileGraph);
      if (!callerTarget) continue;
      if (callerTarget.decl.scope !== MODULE_SCOPE) continue;
      pendingJsxCalls.push({
        target,
        caller: { file: callerTarget.file, symbol: callerTarget.decl.symbol },
      });
    }
  }

  // ── Phase 2: classify ───────────────────────────────────────────────────
  // One judge: the registry. A member owns its JSX; anything else
  // JSX-returning is a helper whose JSX fans out to its callers.
  function classifyKey(file: string, decl: BindingDecl): Classification {
    const key = `${file}::${decl.symbol}`;
    const hit = classificationCache.get(key);
    if (hit !== undefined) return hit;
    const fileGraph = graph.files.get(file);
    const result = fileGraph ? classifyDeclaration(decl, registry, fileGraph) : "unknown";
    classificationCache.set(key, result);
    return result;
  }

  // Walk every module-scope Function- or ReturnTypeOf-valued decl so its
  // classification lands in the cache before resolveOwnerChain runs (a
  // factory's product is ReturnTypeOf-valued). Other decls
  // classify lazily via the same path.
  for (const [file, fileGraph] of graph.files) {
    for (const decl of fileGraph.declarations.values()) {
      if (decl.scope !== MODULE_SCOPE) continue;
      if (decl.value.kind !== "Function" && decl.value.kind !== "ReturnTypeOf") continue;
      classifyKey(file, decl);
    }
  }

  // ── Phase 3: index ──────────────────────────────────────────────────────
  function recordCallerEdge(
    target: { file: string; decl: BindingDecl },
    callerKey: SymbolKey,
  ): void {
    const keyStr = `${target.file}::${target.decl.symbol}`;
    const callerKeyStr = `${callerKey.file}::${callerKey.symbol}`;
    let seen = callerKeysByHelper.get(keyStr);
    if (!seen) {
      seen = new Set();
      callerKeysByHelper.set(keyStr, seen);
    }
    if (seen.has(callerKeyStr)) return;
    seen.add(callerKeyStr);
    let callers = index.get(keyStr);
    if (!callers) {
      callers = new Set();
      index.set(keyStr, callers);
    }
    callers.add(callerKey);
  }

  for (const { target, caller } of pendingValueRefs) {
    if (classifyKey(target.file, target.decl) !== "helper") continue;
    recordCallerEdge(target, caller);
  }
  for (const { target, caller } of pendingJsxCalls) {
    if (classifyKey(target.file, target.decl) !== "helper") continue;
    recordCallerEdge(target, caller);
  }

  return {
    get(key) {
      return index.get(`${key.file}::${key.symbol}`);
    },
    classification(file, symbol) {
      return classificationCache.get(`${file}::${symbol}`) ?? "unknown";
    },
  };
}

/** Walk only the callee side of a value: `ReturnTypeOf.callee` chains and
 *  `MemberOf.obj`, collecting the `TypeOf` refs that name what is being
 *  called. Arguments are deliberately skipped (see Pass A). */
function collectCalleeRefs(t: InferredType, out: Reference[]): void {
  switch (t.kind) {
    case "ReturnTypeOf":
      collectCalleeRefs(t.callee, out);
      return;
    case "MemberOf":
      collectCalleeRefs(t.obj, out);
      return;
    case "TypeOf":
      out.push(t.ref);
      return;
    default:
      return;
  }
}

/** Walk an InferredType, collecting every `TypeOf` ref found at any depth. */
function collectRefsInType(t: InferredType, out: Reference[]): void {
  switch (t.kind) {
    case "TypeOf":
      out.push(t.ref);
      return;
    case "Union":
      for (const u of t.types) collectRefsInType(u, out);
      return;
    case "ReturnTypeOf":
      collectRefsInType(t.callee, out);
      for (const a of t.args) collectRefsInType(a, out);
      return;
    case "Function":
      for (const r of t.returns) collectRefsInType(r, out);
      return;
    case "Object":
      for (const v of Object.values(t.props)) collectRefsInType(v, out);
      return;
    case "Array":
      for (const e of t.elements) collectRefsInType(e, out);
      return;
    case "MemberOf":
      collectRefsInType(t.obj, out);
      return;
    case "ParameterOf":
      // A function's parameter, not a callable reference.
      return;
    default:
      // JSX, Str, Unknown, DynamicImport: no nested refs.
      return;
  }
}
