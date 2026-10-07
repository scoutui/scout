import type { FileGraph, Graph, InferredType, Reference } from "../index.js";
import { boundArgument, type ArgumentMap } from "./argument-map.js";
import { resolveReference } from "./resolve-reference.js";
import { bindingImport, bindingValue, resolveBinding, staticMemberReference, type Binding } from "./binding.js";
import { dynamicImportBinding } from "./wrapper-folding.js";
import { createCycleGuard, type CycleGuard } from "./cycle-detection.js";
import { libraryStubFor } from "./library-stubs.js";
import { assertNever } from "./assert-never.js";
import { ownProp } from "./own-prop.js";

/** Sentinel for dynamic member access (`obj[expr]` where expr isn't a literal). */
export const DYNAMIC_MEMBER_KEY = "";

/**
 * Terminal returned by `resolveType`. `source` is set at every fanout fork
 * (MemberOf-over-Object dynamic-key, MemberOf-over-Array, Union) to the leaf
 * expression that produced this terminal at the innermost fork. Propagated
 * unchanged through non-fanout recursive walks. `null` when no fanout occurred
 * along the walk or when the path bottoms out at a non-identity-bearing
 * terminal (Str, raw Unknown).
 */
export type ResolvedTerminal = {
  type: InferredType;
  source: InferredType | null;
};

/** `obj.member` read through `reachMember`: the reference it names when it
 *  reaches a recorded static member or an import the graph cannot see, else
 *  what `obj` resolves to. */
export type MemberReach = { ref: Reference } | { ref: null; terminals: ResolvedTerminal[] };

/**
 * The reference `obj.member` names when `obj` reaches, directly or through an
 * alias reference's value, a recorded static member, or an object literal's
 * property, either:
 * - a holder whose declaration has `member` recorded (`staticMemberReference`);
 * - an import whose value the graph cannot see (`bindingImport`, value
 *   Unknown), which names that import's reference extended by `member`, or
 *   the import's own reference for `default` read on a default export
 *   (`"default" in X ? X.default : X`).
 *
 * Otherwise the terminals `obj` resolves to, exactly what
 * `resolveType(obj)` returns, found by the same pass. Each holder on the way
 * is resolved once, so the work is linear in the chain's depth.
 *
 * `resolveType`, the walker's `walkStaticMember` and the component judge's
 * `evalKind` all read a static member through it.
 */
export function reachMember(
  graph: Graph,
  fileGraph: FileGraph,
  obj: InferredType,
  member: string,
  argMap: ArgumentMap,
  guard: CycleGuard,
): MemberReach {
  const direct = staticMemberReference(graph, fileGraph, obj, member, guard);
  if (direct !== null) return { ref: direct };
  if (obj.kind !== "TypeOf" && !(obj.kind === "MemberOf" && obj.member !== DYNAMIC_MEMBER_KEY)) {
    return { ref: null, terminals: resolveType(graph, fileGraph, obj, argMap, guard) };
  }
  if (guard.pushNode(obj) === "cycle") return { ref: null, terminals: [{ type: { kind: "Unknown" }, source: null }] };
  try {
    if (obj.kind === "TypeOf") {
      const value = resolveReference(graph, fileGraph, obj.ref, guard);
      if (value.kind === "TypeOf" || value.kind === "MemberOf") return reachMember(graph, fileGraph, value, member, argMap, guard);
      if (value.kind === "Unknown" && bindingImport(graph, fileGraph, obj.ref) !== undefined) {
        if (member === "default" && isDefaultExport(resolveBinding(graph, fileGraph, obj.ref, guard))) return { ref: obj.ref };
        return { ref: { ...obj.ref, memberChain: [...obj.ref.memberChain, member] } };
      }
      return { ref: null, terminals: referenceTerminals(graph, fileGraph, obj, value, argMap, guard) };
    }
    const holder = reachMember(graph, fileGraph, obj.obj, obj.member, argMap, guard);
    if (holder.ref !== null) return reachMember(graph, fileGraph, { kind: "TypeOf", ref: holder.ref }, member, argMap, guard);
    const held = new Map<InferredType, ResolvedTerminal[]>();
    for (const { type } of holder.terminals) {
      const value = type.kind === "Object" ? ownProp(type, obj.member) : undefined;
      if ((value?.kind !== "TypeOf" && value?.kind !== "MemberOf") || held.has(value)) continue;
      const through = reachMember(graph, fileGraph, value, member, argMap, guard);
      if (through.ref !== null) return through;
      held.set(value, through.terminals);
    }
    const terminals = memberTerminals(graph, fileGraph, holder.terminals, obj.member, argMap, guard, (v) => held.get(v) ?? resolveType(graph, fileGraph, v, argMap, guard));
    return { ref: null, terminals };
  } finally {
    guard.popNode(obj);
  }
}

/** Whether `binding` is a package's or an unparsed file's default export itself. */
function isDefaultExport(binding: Binding): boolean {
  return (binding.kind === "package-export" || binding.kind === "unparsed") && binding.exportName === "default" && binding.path.length === 0;
}

/** What a reference resolves to, given the value `resolveReference` found. */
function referenceTerminals(
  graph: Graph,
  fileGraph: FileGraph,
  type: Extract<InferredType, { kind: "TypeOf" }>,
  resolved: InferredType,
  argMap: ArgumentMap,
  guard: CycleGuard,
): ResolvedTerminal[] {
  if (resolved.kind === "Unknown") {
    // Import-backed leaf that can't be reduced further (external package,
    // or in-graph target with unparseable exports): preserve the TypeOf
    // as an identity-bearing terminal instead of collapsing to Unknown.
    // The foldTerminals seam (wrapper-folding.ts) synthesizes occurrence
    // identity from it.
    if (bindingImport(graph, fileGraph, type.ref) !== undefined) {
      return [{ type, source: type }];
    }
    return [{ type: resolved, source: null }];
  }
  return resolveType(graph, fileGraph, resolved, argMap, guard);
}

/** `obj.member` over the terminals `obj` resolves to: an object literal's
 *  property (every property for a dynamic key), each element of an array,
 *  Unknown for anything else. `property` resolves a property's value. */
function memberTerminals(
  graph: Graph,
  fileGraph: FileGraph,
  objTypes: readonly ResolvedTerminal[],
  member: string,
  argMap: ArgumentMap,
  guard: CycleGuard,
  property: (value: InferredType) => ResolvedTerminal[],
): ResolvedTerminal[] {
  const results: ResolvedTerminal[] = [];
  for (const { type: obj } of objTypes) {
    if (obj.kind === "Object") {
      if (member === DYNAMIC_MEMBER_KEY) {
        for (const v of Object.values(obj.props)) {
          const inner = property(v);
          // Set source to the propValue (innermost wins: if inner walk already
          // set source, keep it; this fork is outer).
          for (const r of inner) {
            results.push({ type: r.type, source: r.source ?? v });
          }
        }
      } else {
        const v = ownProp(obj, member);
        if (v) results.push(...property(v));
        else results.push({ type: { kind: "Unknown" }, source: null });
      }
    } else if (obj.kind === "Array") {
      for (const el of obj.elements) {
        const inner = resolveType(graph, fileGraph, el, argMap, guard);
        for (const r of inner) {
          results.push({ type: r.type, source: r.source ?? el });
        }
      }
    } else {
      results.push({ type: { kind: "Unknown" }, source: null });
    }
  }
  return results;
}

/**
 * Walk an InferredType to its terminal types (JSX, Str, Unknown, or
 * concrete TypeOf/ParameterOf leaves that can't be reduced further).
 * Returns one or more results: multi-result for Union and fanout cases.
 */
export function resolveType(
  graph: Graph,
  fileGraph: FileGraph,
  type: InferredType,
  argMap: ArgumentMap,
  guard: CycleGuard = createCycleGuard(),
): ResolvedTerminal[] {
  // Structural cycle guard. Cyclic value graphs are legal JS (see
  // CycleGuard.pushNode); revisiting a node on the current path means the
  // walk can never bottom out, so cut to Unknown. ParameterOf is exempt:
  // the same node legitimately repeats under different argument bindings
  // (nested application of the same function, `id(id(x))`); cycles routed
  // through it are still cut at the ReturnTypeOf node that bound the args.
  if (type.kind === "ParameterOf") {
    return resolveTypeInner(graph, fileGraph, type, argMap, guard);
  }
  if (guard.pushNode(type) === "cycle") {
    return [{ type: { kind: "Unknown" }, source: null }];
  }
  try {
    return resolveTypeInner(graph, fileGraph, type, argMap, guard);
  } finally {
    guard.popNode(type);
  }
}

function resolveTypeInner(
  graph: Graph,
  fileGraph: FileGraph,
  type: InferredType,
  argMap: ArgumentMap,
  guard: CycleGuard,
): ResolvedTerminal[] {
  switch (type.kind) {
    case "JSX":
    case "Str":
    case "Unknown":
      return [{ type, source: null }];

    case "TypeOf":
      return referenceTerminals(graph, fileGraph, type, resolveReference(graph, fileGraph, type.ref, guard), argMap, guard);

    case "Function":
      return type.returns.flatMap((r) => resolveType(graph, fileGraph, r, argMap, guard));

    case "ReturnTypeOf": {
      // Resolve the callee to its bare Function node(s) without expanding
      // their returns: going through resolveType, the Function case would
      // walk the returns before the args are bound.
      // Each entry carries a bindingRef: the Reference that ParameterOf nodes
      // inside the function use as their fn key. For a TypeOf callee this is
      // the callee ref; for a nested ReturnTypeOf chain it's propagated up.
      const calleeFns = resolveToFunctions(
        graph,
        fileGraph,
        type.callee,
        argMap,
        guard,
      );

      const results: ResolvedTerminal[] = [];
      for (const { fn, bindingRef } of calleeFns) {
        if (fn.kind !== "Function") {
          results.push({ type: { kind: "Unknown" }, source: null });
          continue;
        }
        if (bindingRef) argMap.bind(bindingRef, type.args);
        try {
          for (const ret of fn.returns) {
            results.push(...resolveType(graph, fileGraph, ret, argMap, guard));
          }
        } finally {
          if (bindingRef) argMap.unbind(bindingRef);
        }
      }
      return results;
    }

    case "ParameterOf": {
      const subbed = boundArgument(argMap, type);
      if (!subbed) return [{ type: { kind: "Unknown" }, source: null }];
      return resolveType(graph, fileGraph, subbed, argMap, guard);
    }

    case "MemberOf": {
      const resolveProperty = (v: InferredType) => resolveType(graph, fileGraph, v, argMap, guard);
      if (type.member === DYNAMIC_MEMBER_KEY) {
        return memberTerminals(graph, fileGraph, resolveType(graph, fileGraph, type.obj, argMap, guard), type.member, argMap, guard, resolveProperty);
      }
      const reached = reachMember(graph, fileGraph, type.obj, type.member, argMap, guard);
      if (reached.ref !== null) return resolveType(graph, fileGraph, { kind: "TypeOf", ref: reached.ref }, argMap, guard);
      return memberTerminals(graph, fileGraph, reached.terminals, type.member, argMap, guard, resolveProperty);
    }

    case "Union":
      return type.types.flatMap((t) => {
        const inner = resolveType(graph, fileGraph, t, argMap, guard);
        return inner.map((r) => ({ type: r.type, source: r.source ?? t }));
      });

    case "Object":
    case "Array":
      return [{ type, source: null }];

    case "DynamicImport": {
      // Every dead end preserves the DynamicImport as an identity-bearing
      // terminal (specifier + projection) rather than collapsing to Unknown:
      // the foldTerminals seam (wrapper-folding.ts) synthesizes occurrence
      // identity from it.
      const target = resolveDynamicImportTarget(graph, fileGraph, type);
      if (!target) return [{ type, source: type }];
      return resolveType(graph, target.targetFileGraph, target.value, argMap, guard);
    }

    default:
      return assertNever(type);
  }
}

/**
 * A DynamicImport's target: the binding its specifier's projected export
 * names from the file that contains the `import()`. For a declaration, the
 * declaring file and its value, with any remaining projection applied as
 * member walks. Null otherwise, so a package export or an unparsed file stays
 * the `DynamicImport`. Resolved on its own cycle guard, not the walk's.
 */
export function resolveDynamicImportTarget(
  graph: Graph,
  fileGraph: FileGraph,
  di: Extract<InferredType, { kind: "DynamicImport" }>,
): { targetFileGraph: FileGraph; value: InferredType } | null {
  const b = dynamicImportBinding(graph, fileGraph, di);
  const targetFileGraph = b.kind === "declaration" ? graph.files.get(b.file) : undefined;
  if (!targetFileGraph) return null;
  let value = bindingValue(b);
  for (const member of di.projection.slice(1)) value = { kind: "MemberOf", obj: value, member };
  return { targetFileGraph, value };
}

export type FnEntry = { fn: InferredType; bindingRef: Reference | null };

/**
 * Resolve a type down to its bare Function node(s) without expanding their
 * returns[]. Used by ReturnTypeOf so that args can be bound before the
 * function body is walked.
 *
 * Each entry carries a `bindingRef`: the Reference that `ParameterOf` nodes
 * inside the function use as their `fn` key. For `TypeOf` callees this is the
 * referenced symbol; for nested `ReturnTypeOf` chains it is propagated from
 * the innermost `TypeOf` that started the chain, because `ParameterOf` nodes
 * are authored with that outer ref (e.g. `id()(Foo)` where the inner
 * function's body has `ParameterOf(idRef, 0)` and the outer invocation
 * supplies `Foo`).
 *
 * Follows: TypeOf (via resolveReference), Union fanout, and nested
 * ReturnTypeOf chains. Returns `{fn: Unknown}` when the chain doesn't bottom
 * out at Function.
 */
export function resolveToFunctions(
  graph: Graph,
  fileGraph: FileGraph,
  type: InferredType,
  argMap: ArgumentMap,
  guard: CycleGuard,
): FnEntry[] {
  // Same structural cycle guard as resolveType: self-recursive functions
  // (`function f() { return f(); }`) loop through this walk's ReturnTypeOf
  // expansion without re-entering resolveReference.
  if (guard.pushNode(type) === "cycle") {
    return [{ fn: { kind: "Unknown" }, bindingRef: null }];
  }
  try {
    return resolveToFunctionsInner(graph, fileGraph, type, argMap, guard);
  } finally {
    guard.popNode(type);
  }
}

function resolveToFunctionsInner(
  graph: Graph,
  fileGraph: FileGraph,
  type: InferredType,
  argMap: ArgumentMap,
  guard: CycleGuard,
): FnEntry[] {
  switch (type.kind) {
    case "Function":
      return [{ fn: type, bindingRef: null }];

    case "TypeOf": {
      const resolved = resolveReference(graph, fileGraph, type.ref, guard);
      // Carry the TypeOf ref through so the caller can bind args to it.
      const inner = resolveToFunctions(graph, fileGraph, resolved, argMap, guard);
      return inner.map((e) => ({ fn: e.fn, bindingRef: e.bindingRef ?? type.ref }));
    }

    // React/preact's `memo`/`forwardRef` used via a default or namespace
    // import lower to `MemberOf(TypeOf(reactRef), "memo")` as a callee:
    // `reactRef.memberChain` is empty, the member name lives
    // on this MemberOf node instead. Resolve the base ref first; only when it
    // is genuinely import-backed (bare resolution comes back Unknown and
    // `bindingImport` finds the import record in the reference's own scope,
    // so no in-scope declaration shadows it) re-key it as a synthetic ref
    // carrying the member as `memberChain: [type.member]`, the exact shape
    // `libraryStubFor` already reads for `import React from "react";
    // React.memo` (mirrors the named-import case just above, which the
    // parser lowers with the member already in `ref.memberChain`).
    case "MemberOf": {
      if (type.obj.kind === "TypeOf") {
        const resolvedObj = resolveReference(graph, fileGraph, type.obj.ref, guard);
        if (resolvedObj.kind === "Unknown") {
          const imp = bindingImport(graph, fileGraph, type.obj.ref);
          if (imp) {
            const memberRef: Reference = { ...type.obj.ref, memberChain: [type.member] };
            const stub = libraryStubFor(imp, memberRef);
            if (stub) {
              const inner = resolveToFunctions(graph, fileGraph, stub, argMap, guard);
              return inner.map((e) => ({ fn: e.fn, bindingRef: e.bindingRef ?? memberRef }));
            }
          }
        }
      }
      return [{ fn: { kind: "Unknown" }, bindingRef: null }];
    }

    case "Union":
      return type.types.flatMap((t) =>
        resolveToFunctions(graph, fileGraph, t, argMap, guard),
      );

    case "ParameterOf": {
      // A called reference can resolve (via resolveReference's plain scope
      // walk, which never substitutes) to a bare, still-unsubstituted
      // ParameterOf, e.g. a factory that calls its own parameter,
      // `(render) => (props) => render(props)`. Substitute through the
      // argument map (same rule resolveType's own ParameterOf case uses) and
      // keep reducing so the callee still bottoms out at a Function.
      const subbed = boundArgument(argMap, type);
      if (!subbed) return [{ fn: { kind: "Unknown" }, bindingRef: null }];
      return resolveToFunctions(graph, fileGraph, subbed, argMap, guard);
    }

    case "ReturnTypeOf": {
      // Recursively resolve the inner callee to Function entries, then walk
      // each function's returns to find Functions one level deeper.
      const innerFns = resolveToFunctions(
        graph,
        fileGraph,
        type.callee,
        argMap,
        guard,
      );
      const results: FnEntry[] = [];
      for (const { fn, bindingRef } of innerFns) {
        if (fn.kind !== "Function") {
          results.push({ fn: { kind: "Unknown" }, bindingRef: null });
          continue;
        }
        if (bindingRef) argMap.bind(bindingRef, type.args);
        try {
          for (const ret of fn.returns) {
            const deeper = resolveToFunctions(graph, fileGraph, ret, argMap, guard);
            // Propagate bindingRef so the outer call can bind to the same ref.
            results.push(
              ...deeper.map((e) => ({
                fn: e.fn,
                bindingRef: e.bindingRef ?? bindingRef,
              })),
            );
          }
        } finally {
          if (bindingRef) argMap.unbind(bindingRef);
        }
      }
      return results;
    }

    case "JSX":
    case "Str":
    case "Unknown":
    case "Object":
    case "Array":
    case "DynamicImport":
      return [{ fn: { kind: "Unknown" }, bindingRef: null }];
    default:
      return assertNever(type);
  }
}
