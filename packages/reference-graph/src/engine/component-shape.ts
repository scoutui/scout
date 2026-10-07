import type { FileGraph, Graph, InferredType } from "../index.js";
import { boundArgument, createArgumentMap, type ArgumentMap } from "./argument-map.js";
import { createCycleGuard, type CycleGuard } from "./cycle-detection.js";
import { resolveReference } from "./resolve-reference.js";
import { bindingImport, fileGraphForRef, findLocalDeclaration } from "./binding.js";
import { reachMember, resolveToFunctions, resolveType, DYNAMIC_MEMBER_KEY, type FnEntry } from "./resolve-type.js";
import { assertNever } from "./assert-never.js";
import { ownProp } from "./own-prop.js";
import type { OpaqueSemantics } from "./denotation.js";
import { libraryExportFor } from "./library-stubs.js";

/**
 * The component-shape predicate. Reduces an InferredType
 * to what its value is:
 *
 *   "jsx":        a JSX value (`const br = <br/>`, or what calling a
 *                 component yields). Not a component.
 *   "component":  a function whose returns are directly JSX, or a call that
 *                 evaluates to one.
 *   "unresolved": bottoms out at an import the graph cannot see with nothing
 *                 component-shaped in hand.
 *   "other":      anything else: factories, data, hooks, strings.
 *
 * The non-recursion into nested Function returns is load-bearing: a Function
 * whose return is itself a Function evaluates that return to "component",
 * not "jsx", so the outer function is "other" (a factory). That single rule
 * separates `makeControl` from its products. Registry membership, the
 * registry's component judge and owner classification all call it.
 */
export type ValueKind = "jsx" | "component" | "unresolved" | "other";

type Ctx = { graph: Graph; fileGraph: FileGraph; argMap: ArgumentMap; guard: CycleGuard };

export function evalKind(
  type: InferredType,
  graph: Graph,
  fileGraph: FileGraph,
  argMap: ArgumentMap = createArgumentMap(),
  guard: CycleGuard = createCycleGuard(),
): ValueKind {
  return evalInner(type, { graph, fileGraph, argMap, guard });
}

/** Priority merge for fan-out shapes: jsx > component > unresolved > other. */
function merge(kinds: ValueKind[]): ValueKind {
  if (kinds.includes("jsx")) return "jsx";
  if (kinds.includes("component")) return "component";
  if (kinds.includes("unresolved")) return "unresolved";
  return "other";
}

function evalInner(t: InferredType, ctx: Ctx): ValueKind {
  if (ctx.guard.pushNode(t) === "cycle") return "other";
  try {
    switch (t.kind) {
      case "JSX":
        return "jsx";
      case "Function":
        return t.returns.some((r) => evalInner(r, ctx) === "jsx") ? "component" : "other";
      case "Union":
        return merge(t.types.map((u) => evalInner(u, ctx)));
      case "ParameterOf": {
        const bound = boundArgument(ctx.argMap, t);
        return bound ? evalInner(bound, ctx) : "other";
      }
      case "TypeOf": {
        const resolved = resolveReference(ctx.graph, ctx.fileGraph, t.ref, ctx.guard);
        if (resolved.kind === "Unknown") return isImportBacked(t, ctx.graph, ctx.fileGraph) ? "unresolved" : "other";
        return evalInner(resolved, ctx);
      }
      case "MemberOf": {
        const reached = t.member === DYNAMIC_MEMBER_KEY ? null : reachMember(ctx.graph, ctx.fileGraph, t.obj, t.member, ctx.argMap, ctx.guard);
        if (reached?.ref) return evalInner({ kind: "TypeOf", ref: reached.ref }, ctx);
        const objs = reached?.terminals ?? resolveType(ctx.graph, ctx.fileGraph, t.obj, ctx.argMap, ctx.guard);
        const kinds: ValueKind[] = [];
        for (const { type: obj } of objs) {
          if (obj.kind !== "Object") continue;
          // A dynamic-key access (`BannerComponent[type]`) could select any
          // prop at runtime, so merge the shape of every prop the object
          // carries, the same "any branch could be it" treatment Union gets.
          if (t.member === DYNAMIC_MEMBER_KEY) {
            for (const prop of Object.values(obj.props)) kinds.push(evalInner(prop, ctx));
            continue;
          }
          const prop = ownProp(obj, t.member);
          if (prop) kinds.push(evalInner(prop, ctx));
        }
        return kinds.length === 0 ? "other" : merge(kinds);
      }
      case "ReturnTypeOf":
        return evalCall(t, ctx);
      case "Str":
      case "Object":
      case "Array":
      case "Unknown":
      case "DynamicImport":
        // A literal array of JSX elements is deliberately "other", the same
        // treatment a Function returning Object-containing-JSX gets ("data
        // factory"): helper-callers.ts's helper/component split depends
        // on a Function returning Array<JSX> classifying as a helper, not a
        // component, so its callers attribute correctly via helper-call
        // chains instead of it becoming a standalone identity. The
        // ".map(render)" and dynamic-member patterns don't need this arm:
        // both resolve to "jsx" through evalCall's opaque-MemberOf-callee
        // rule and the MemberOf DYNAMIC_MEMBER_KEY merge instead.
        return "other";
      default:
        return assertNever(t);
    }
  } finally {
    ctx.guard.popNode(t);
  }
}

function evalCall(t: Extract<InferredType, { kind: "ReturnTypeOf" }>, ctx: Ctx): ValueKind {
  // A non-component product (a context) holds its arguments; it never wraps them.
  if (nonComponentProduct(ctx.graph, ctx.fileGraph, t.callee, ctx.guard) !== null) return "other";
  // `lazy(() => import('./x'))` and friends: the engine's lazy-import rule
  // owns identity; for shape purposes the call is a component.
  if (t.args.some((a) => containsDynamicImport(a))) return "component";

  const fns = resolveToFunctions(ctx.graph, ctx.fileGraph, t.callee, ctx.argMap, ctx.guard);
  const resolvable: FnEntry[] = [];
  for (const f of fns) {
    if (f.fn.kind === "Function") resolvable.push(f);
  }

  if (resolvable.length === 0) {
    // Opaque callee: component iff some argument is
    // component-shaped or an import-backed leaf the engine will fold to. A
    // non-component product call (`withX(createContext(…))`) is neither.
    const isProductCall = (a: InferredType) =>
      a.kind === "ReturnTypeOf" && nonComponentProduct(ctx.graph, ctx.fileGraph, a.callee, ctx.guard) !== null;
    const carries = t.args.some(
      (a) => evalInner(a, ctx) === "component" || (isImportBackedLeaf(a, ctx.graph, ctx.fileGraph, ctx.guard) && !isProductCall(a)),
    );
    if (!carries) return "unresolved";
    // A method call on non-import-backed data (a parameter, a local
    // array/object literal, a hook result, a global like `Object.keys(x)`)
    // with a component-shaped argument is a *render callback*
    // (`items.map(({...}) => <Button/>)`), not a wrapper that takes a
    // component as a prop: the call's output is rendered JSX, not a
    // component. An import-backed callee (the genuinely unresolvable HOC)
    // keeps "component". wrapper-folding.ts's opaque step makes the parallel
    // identity-folding decision with the same `isImportBackedLeaf` condition.
    if (t.callee.kind === "MemberOf" && !isImportBackedLeaf(t.callee, ctx.graph, ctx.fileGraph, ctx.guard)) return "jsx";
    return "component";
  }

  const kinds: ValueKind[] = [];
  for (const { fn, bindingRef } of resolvable) {
    if (fn.kind !== "Function") continue;
    if (bindingRef) ctx.argMap.bind(bindingRef, t.args);
    try {
      for (const ret of fn.returns) kinds.push(evalInner(ret, ctx));
    } finally {
      if (bindingRef) ctx.argMap.unbind(bindingRef);
    }
  }
  return merge(kinds);
}

function isImportBacked(t: Extract<InferredType, { kind: "TypeOf" }>, graph: Graph, fileGraph: FileGraph): boolean {
  return bindingImport(graph, fileGraph, t.ref) !== undefined;
}

/** A TypeOf (possibly under a ReturnTypeOf chain, or a MemberOf access on
 *  one, as in `Sentry.withProfiler`) that names an import the graph cannot
 *  resolve: the shape the opaque-HOC fold synthesises identity from.
 *  Unwrapping MemberOf.obj is what keeps an import-backed namespace member
 *  call out of the render-callback narrowing.
 *
 *  `evalCall` and `wrapper-folding.ts`'s opaque-callee identity-fold step
 *  both use it to decide whether a call is a data-method render call rather
 *  than a wrapper. */
export function isImportBackedLeaf(t: InferredType, graph: Graph, fileGraph: FileGraph, guard: CycleGuard): boolean {
  let cur: InferredType = t;
  while (cur.kind === "ReturnTypeOf" || cur.kind === "MemberOf") {
    cur = cur.kind === "ReturnTypeOf" ? cur.callee : cur.obj;
  }
  if (cur.kind !== "TypeOf") return false;
  if (!isImportBacked(cur, graph, fileGraph)) return false;
  return resolveReference(graph, fileGraph, cur.ref, guard).kind === "Unknown";
}

/**
 * The semantics of the non-component value a call produces: the stub table's
 * entry for the callee's export, when the callee is an import the graph cannot
 * see (`isImportBackedLeaf`, the same predicate the unseen-hook rule uses).
 * Null for every other call. `walkReturnTypeOf` names such a call's product
 * from it, and `evalCall` below answers "other" for it.
 *
 * The callee's spelling is read through `libraryExportFor`, the one table
 * `libraryStubFor` reads: a reference (a named import, or a default /
 * namespace import carrying the member on the ref) or a member access on one
 * (`React.createContext`).
 */
export function nonComponentProduct(
  graph: Graph,
  fileGraph: FileGraph,
  callee: InferredType,
  guard: CycleGuard,
): OpaqueSemantics | null {
  const ref =
    callee.kind === "TypeOf"
      ? callee.ref
      : callee.kind === "MemberOf" && callee.obj.kind === "TypeOf"
        ? { ...callee.obj.ref, memberChain: [callee.member] }
        : null;
  if (ref === null) return null;
  const imp = bindingImport(graph, fileGraph, ref);
  const entry = imp === undefined ? null : libraryExportFor(imp, ref);
  if (entry === null || entry.kind !== "non-component-product") return null;
  return isImportBackedLeaf(callee, graph, fileGraph, guard) ? entry.semantics : null;
}

/** Answers "is there an `import()` anywhere in this value", for reporting
 *  only. It descends every node kind that can hold one and never claims a
 *  projection, so the specifier it hands back names the import the diagnostic
 *  points at, nothing more.
 *
 *  Not `findFirstDynamicImport` (`wrapper-folding.ts`): that one decides
 *  credit, is deliberately narrower, and is the only one that may claim a
 *  projection. */
export function firstDynamicImport(t: InferredType): Extract<InferredType, { kind: "DynamicImport" }> | null {
  return searchDynamicImport(t, null);
}

/** The value of the binding a reference names, or null. */
type BindingPeek = (t: Extract<InferredType, { kind: "TypeOf" }>) => InferredType | null;

function searchDynamicImport(t: InferredType, peek: BindingPeek | null): Extract<InferredType, { kind: "DynamicImport" }> | null {
  switch (t.kind) {
    case "DynamicImport":
      return t;
    case "Function":
      for (const r of t.returns) {
        const hit = searchDynamicImport(r, peek);
        if (hit) return hit;
      }
      return null;
    case "ReturnTypeOf": {
      const inCallee = searchDynamicImport(t.callee, peek);
      if (inCallee) return inCallee;
      for (const a of t.args) {
        const hit = searchDynamicImport(a, peek);
        if (hit) return hit;
      }
      return null;
    }
    case "MemberOf":
      return searchDynamicImport(t.obj, peek);
    case "Union":
      for (const u of t.types) {
        const hit = searchDynamicImport(u, peek);
        if (hit) return hit;
      }
      return null;
    case "Object":
      for (const v of Object.values(t.props)) {
        const hit = searchDynamicImport(v, peek);
        if (hit) return hit;
      }
      return null;
    case "Array":
      for (const e of t.elements) {
        const hit = searchDynamicImport(e, peek);
        if (hit) return hit;
      }
      return null;
    case "TypeOf": {
      const bound = peek?.(t) ?? null;
      return bound === null ? null : searchDynamicImport(bound, null);
    }
    default:
      return null;
  }
}

/** True when there is an `import()` anywhere in this value, by
 *  `firstDynamicImport`'s descent; it claims no projection. Given `at`, a
 *  reference is followed once: the binding it names is found scope-aware in
 *  the file the reference was written in, and that binding's value is
 *  searched with no further peek. */
export function containsDynamicImport(t: InferredType, at?: { graph: Graph; fileGraph: FileGraph }): boolean {
  const peek: BindingPeek | null =
    at === undefined
      ? null
      : (ref) => findLocalDeclaration(fileGraphForRef(at.graph, ref.ref, at.fileGraph), ref.ref)?.value ?? null;
  return searchDynamicImport(t, peek) !== null;
}
