import type { BindingDecl, Graph, FileGraph, InferredType } from "../index.js";
import type { OccurrenceVia } from "../types/occurrence-via.js";
import type { Known, UnresolvedReason } from "@scoutui/scan-format";
import { reachMember, resolveType, resolveToFunctions, resolveDynamicImportTarget, DYNAMIC_MEMBER_KEY, type ResolvedTerminal } from "./resolve-type.js";
import type { ArgumentMap } from "./argument-map.js";
import { argumentRefKey, boundArgument } from "./argument-map.js";
import { createCycleGuard, type CycleGuard } from "./cycle-detection.js";
import { resolveReference } from "./resolve-reference.js";
import { bindingImport, resolveBinding, resolveModuleExport, walkedIdentity, type Binding } from "./binding.js";
import { packageNameFromSpecifier } from "./specifier.js";
import { containsDynamicImport, evalKind, isImportBackedLeaf, nonComponentProduct } from "./component-shape.js";
import { HOOK_NAME } from "./host-element.js";
import { assertNever } from "./assert-never.js";
import { creditedTerminals, isCallable, matchDenotation, type Denotation, type DenotationCases, type Evaluation, type LateBoundSource, type OpaqueSemantics, type Terminal } from "./denotation.js";

/** True when a `ReturnTypeOf`'s callee is a data-method render
 *  call (`items.map(render)`) rather than a wrapper taking a component as a
 *  prop: a `MemberOf` callee that is not an import-backed leaf (`Sentry.x`
 *  stays a wrapper; `items.map`/a hook result/a parameter does not). The
 *  opaque-callee branch of `evalCall` (`component-shape.ts`) uses the same
 *  condition to answer `"jsx"` instead of `"component"`. */
function isDataMethodRenderCall(type: Extract<InferredType, { kind: "ReturnTypeOf" }>, graph: Graph, fileGraph: FileGraph, guard: CycleGuard): boolean {
  return type.callee.kind === "MemberOf" && !isImportBackedLeaf(type.callee, graph, fileGraph, guard);
}

/** True when a value is a loader: a function whose body holds an `import()`,
 *  inline, or reached from a reference through a chain of aliases, or held by
 *  a static member of an object literal (by every member, for a dynamic one)
 *  that the value names directly or through such a chain. Each reference
 *  resolves in its own file. Anything else, a `lazy()` holder or a wrapper
 *  product included, is not. */
function isLoader(value: InferredType, graph: Graph, fileGraph: FileGraph, guard: CycleGuard): boolean {
  if (value.kind === "Function") return containsDynamicImport(value, { graph, fileGraph });
  if (value.kind !== "TypeOf" && value.kind !== "MemberOf") return false;
  if (guard.pushNode(value) === "cycle") return false;
  try {
    if (value.kind === "TypeOf") return isLoader(resolveReference(graph, fileGraph, value.ref, guard), graph, fileGraph, guard);
    const holder = objectLiteralOf(value.obj, graph, fileGraph, guard);
    if (holder === null) return false;
    if (value.member !== DYNAMIC_MEMBER_KEY) {
      const held = holder.props[value.member];
      return held !== undefined && isLoader(held, graph, fileGraph, guard);
    }
    const all = Object.values(holder.props);
    return all.length > 0 && all.every((v) => isLoader(v, graph, fileGraph, guard));
  } finally {
    guard.popNode(value);
  }
}

/** The object literal a value is, directly or through a chain of aliases. */
function objectLiteralOf(
  value: InferredType,
  graph: Graph,
  fileGraph: FileGraph,
  guard: CycleGuard,
): Extract<InferredType, { kind: "Object" }> | null {
  if (value.kind === "Object") return value;
  if (value.kind !== "TypeOf" || guard.pushNode(value) === "cycle") return null;
  try {
    return objectLiteralOf(resolveReference(graph, fileGraph, value.ref, guard), graph, fileGraph, guard);
  } finally {
    guard.popNode(value);
  }
}

/**
 * Identity hint for a folded terminal. Tells the engine which binding produced
 * this terminal so componentId derives from the folded-to-inner identity.
 *
 * - `imported`: leaf binding is an export of a package outside the scan.
 *   Engine builds componentId from { specifier, imported }, unless
 *   `unresolved` says why the export names no component
 *   (`unresolvedPackageExport`): the engine then emits an unresolved
 *   occurrence.
 * - `local`: leaf binding is a declaration in a parsed file, or an export of a
 *   first-party file the scan did not parse (pinned to its definition). Engine
 *   builds componentId from { filePath, export }. `declaration` is the
 *   declaration a tag-position self-stamp's reference resolved to in its own
 *   scope; the registry's tagged membership and its component judge read it.
 *   `definition` is where a pinned unparsed file declares it (`pinUnparsed`).
 * - `null`: terminal didn't come from an identifiable binding (literal, anonymous
 *   expression, etc.), or its leaf names nothing (`isIndeterminateLeaf`). A
 *   credited terminal with no identity takes the JsxUsage's own ref as its
 *   identity source.
 */
export type TerminalIdentity =
  | { kind: "imported"; specifier: string; imported: string; unresolved?: Known<UnresolvedReason> }
  | {
      kind: "local";
      filePath: string;
      export: string;
      declaration?: BindingDecl;
      definition?: { line: number; column: number };
    }
  | null;

/** The denotation of a branch the walk learned nothing about. */
const INDETERMINATE: Denotation = { kind: "indeterminate" };

/**
 * A terminal inside the walk. `semantics` marks a value the stub table names a
 * non-component product; the terminal keeps the denotation the folds computed
 * for it, so every predicate below sees the same denotation with or without
 * the mark. `walkWithFolding` turns a surviving mark into the public
 * `opaque` denotation; nothing else may read it, and no code outside this file
 * sees the type.
 *
 * The mark is set at two sites, the identity stamp in `walkTypeOf` (an alias of
 * a product is that product) and the member fold in `walkStaticMember` (any
 * member of a product is that product); an arm that forwards a terminal
 * unchanged forwards its mark; and every site that rebuilds a terminal drops it
 * (a wrapper hop, a lazy target, a dynamic-map branch, a relabel, a returned
 * value, a synthesised leaf) except those two. Dropping is the safe direction:
 * the tag keeps reporting, and nothing reaches the payload.
 *
 * `namesNothing` marks the terminal of an indeterminate leaf
 * (`isIndeterminateLeaf`) and of every fold that came to nothing but such
 * terminals. No identity stamp gives it an identity, so no holder over it is
 * credited in its place. `walkWithFolding` drops it at the public boundary.
 */
type Walked = Terminal & { semantics?: OpaqueSemantics | undefined; namesNothing?: true };

function withSemantics(t: Walked, semantics: OpaqueSemantics): Walked {
  return { denotation: t.denotation, viaTrail: t.viaTrail, identity: t.identity, semantics };
}

/** The product every branch of an evaluation is marked with; null when any
 *  branch is unmarked or marked differently. */
function markedProduct(terminals: readonly Walked[]): OpaqueSemantics | null {
  const first = terminals[0]?.semantics;
  if (first === undefined) return null;
  return terminals.every((t) => t.semantics === first) ? first : null;
}

/** Whether a branch came to nothing (the walk's counterpart of the algebra's
 *  `Unknown`), read only through `matchDenotation`.
 *
 *  `late-bound` answers `true`: the values it classifies reduce to `Unknown` in
 *  the algebra. `opaque` is in the record for exhaustiveness only: the walk
 *  mints it at the public boundary and never reads it back, so no internal
 *  path can observe that handler. */
const CAME_TO_NOTHING: DenotationCases<boolean> = {
  element: () => false,
  foreign: () => false,
  "host-string": () => false,
  opaque: () => true,
  "late-bound": () => true,
  data: () => false,
  indeterminate: () => true,
  callable: () => false,
};

function cameToNothing(t: Terminal): boolean {
  return matchDenotation(t, CAME_TO_NOTHING);
}

const IS_LATE_BOUND: DenotationCases<boolean> = {
  element: () => false,
  foreign: () => false,
  "host-string": () => false,
  opaque: () => false,
  "late-bound": () => true,
  data: () => false,
  indeterminate: () => false,
  callable: () => false,
};

/**
 * Rename a branch that came to nothing, keeping its identity and viaTrail
 * exactly as the fold produced them, and dropping any product mark: the new
 * denotation is what the branch is now. A branch that reduced to something the
 * walk does know keeps its own denotation and its mark.
 */
function relabel(denotation: Denotation): (t: Walked) => Walked {
  return (t) => (cameToNothing(t) ? { denotation, viaTrail: t.viaTrail, identity: t.identity } : t);
}

function asLateBound(source: LateBoundSource): (t: Walked) => Walked {
  return relabel({ kind: "late-bound", source });
}

/** True when every branch of an evaluation is a value supplied elsewhere. */
function evaluatesLateBound(terminals: readonly Terminal[]): boolean {
  return terminals.length > 0 && terminals.every((t) => matchDenotation(t, IS_LATE_BOUND));
}

/**
 * The boundary between "what this value is" and "what this function returns".
 *
 * A string becomes the data the function returns; a late-bound value becomes
 * "nothing known"; a product mark is dropped, so a function that returns a
 * context is not itself a context. `opaque` is in the record for
 * exhaustiveness only: no internal path produces that denotation.
 *
 * Applied at two places: the `Function` arm of `walkInner` and the exit of
 * `walkReturnTypeOf`.
 */
const AS_RETURNED_VALUE: DenotationCases<Denotation> = {
  element: (d) => d,
  foreign: (d) => d,
  "host-string": () => ({ kind: "data", shape: "string" }),
  opaque: () => INDETERMINATE,
  "late-bound": () => INDETERMINATE,
  data: (d) => d,
  indeterminate: (d) => d,
  callable: (d) => d,
};

function returnedValue(t: Walked): Walked {
  const denotation = matchDenotation(t, AS_RETURNED_VALUE);
  return denotation === t.denotation && t.semantics === undefined
    ? t
    : { denotation, viaTrail: t.viaTrail, identity: t.identity };
}

function indeterminateTerminal(): Walked {
  return { denotation: INDETERMINATE, viaTrail: [], identity: null };
}

function namesNothingTerminal(): Walked {
  return { denotation: INDETERMINATE, viaTrail: [], identity: null, namesNothing: true };
}

/** Whether every terminal of a non-empty walk is `namesNothing`. */
function allNameNothing(terminals: readonly Walked[]): boolean {
  return terminals.length > 0 && terminals.every((t) => t.namesNothing === true);
}

/** The only place a product mark becomes a denotation. A marked branch the tag
 *  would credit keeps the denotation it earned; any other marked branch is the
 *  product. */
function published(t: Walked): Terminal {
  if (t.semantics === undefined) {
    return t.namesNothing === true ? { denotation: t.denotation, viaTrail: t.viaTrail, identity: t.identity } : t;
  }
  const denotation: Denotation =
    creditedTerminals([t]).length > 0 ? t.denotation : { kind: "opaque", semantics: t.semantics };
  return { denotation, viaTrail: t.viaTrail, identity: t.identity };
}

/** The public boundary's guarantee, and only the public boundary's: an
 *  `Evaluation` handed to a caller is never empty, because a caller has
 *  nothing to read otherwise. Inside the walk `[]` stays `[]`. */
function atLeastOne(terminals: readonly Terminal[]): Evaluation {
  return terminals.length > 0 ? (terminals as Evaluation) : [indeterminateTerminal()];
}

/**
 * What one `resolveType` terminal denotes. `synthesised` marks the unreducible
 * import-backed leaf `foldTerminals` mints an identity for: the reference is
 * real and its target unparseable, so the value is `foreign`. `indeterminate`
 * is reserved for the terminal the algebra bottomed out at knowing nothing;
 * a value the algebra did reduce, to a string or to data, is not that.
 */
function denote(type: InferredType, synthesised: boolean): Denotation {
  if (synthesised) return { kind: "foreign" };
  switch (type.kind) {
    case "JSX":
      return { kind: "element" };
    case "Str":
      return { kind: "host-string", value: type.value };
    case "Object":
      return { kind: "data", shape: "object" };
    case "Array":
      return { kind: "data", shape: "array" };
    case "TypeOf":
    case "Function":
    case "ReturnTypeOf":
    case "ParameterOf":
    case "MemberOf":
    case "Union":
    case "Unknown":
    case "DynamicImport":
      return INDETERMINATE;
    default:
      return assertNever(type);
  }
}

/**
 * Unreducible-leaf identity synthesis, called by `foldLeaf` and `foldCall`'s
 * algebra step.
 *
 * Maps `resolveType` results into Terminals. When the algebra preserved
 * an identity-bearing leaf (an import-backed TypeOf or a DynamicImport that
 * couldn't be reduced, see resolve-type.ts's TypeOf/DynamicImport cases),
 * synthesize a `foreign` terminal carrying the identity derived from the
 * terminal itself: the reference is real even though its target can't be parsed
 * (external package, CJS, unresolvable specifier). Every other terminal
 * derives identity from `source`, falling back to `fallback` only when the
 * branch itself carries none.
 */
function foldTerminals(
  graph: Graph,
  fileGraph: FileGraph,
  results: ResolvedTerminal[],
  fallback: InferredType,
): Walked[] {
  return results.map(({ type: t, source }) => {
    if (t.kind === "TypeOf" || t.kind === "DynamicImport") {
      const binding = leafBinding(graph, fileGraph, t);
      const identity = walkedIdentity(graph, binding);
      if (identity !== null) {
        return { denotation: denote(t, true), viaTrail: [], identity };
      }
      if (isIndeterminateLeaf(binding)) return namesNothingTerminal();
    }
    // A fan-out branch (Union / dynamic-map) is stamped as `source`. Derive
    // from it first, since a branch that has its own binding must win, and
    // only fall back to the resolved binding when the branch carries no
    // identity of its own (e.g. a bare `{kind:"JSX"}` branch from a lowered
    // ternary/logical render body).
    const identity = (source && deriveIdentity(source, fileGraph, graph)) ?? deriveIdentity(fallback, fileGraph, graph);
    return {
      denotation: denote(t, false),
      viaTrail: [],
      identity,
    };
  });
}

/**
 * The indeterminate-leaf rule: an import-backed leaf whose binding names
 * nothing: a failed import, an export its module does not have or the
 * resolution cannot follow, or a name its module never binds. Its terminal is
 * `indeterminate`, `namesNothing` and carries no identity: none of its own,
 * none stamped from the branch's source or the walk's fallback, and none
 * stamped later by a reference or a lazy import over it, so no holder over it
 * is credited in its place.
 */
function isIndeterminateLeaf(binding: Binding): boolean {
  return (
    binding.kind === "import-failed" || binding.kind === "no-export" || binding.kind === "unfollowed" || binding.kind === "unbound"
  );
}

/**
 * Fold a wrapper call to its wrapped argument's terminals. Shared by the
 * structural pass-through step (2b) and the opaque-HOC fallback (step 4) so
 * a seen-through wrapper and an opaque one attribute identically. Inner
 * terminals pass through with the wrapper hop prepended. When the inner walk
 * came to nothing but a terminal carries an identity (a package export, an
 * unparsed first-party file), synthesise a `foreign` terminal from the first
 * such identity, so a HOC-wrapped occurrence isn't dropped. Truly nothing →
 * a single indeterminate terminal.
 */
function foldToWrappedArg(inner: readonly Walked[], via: OccurrenceVia): Walked[] {
  // Drops the product mark: what a wrapper call returns is not the wrapped
  // value, so `memo(Ctx)` is not a context.
  const innerHasNonUnknown = inner.some((t) => !cameToNothing(t));
  if (innerHasNonUnknown) {
    return inner.map((t) => ({ denotation: t.denotation, viaTrail: [via, ...t.viaTrail], identity: t.identity }));
  }
  const synthesisIdentity = inner.find((t) => t.identity !== null)?.identity ?? null;
  if (synthesisIdentity) {
    return [{ denotation: { kind: "foreign" }, viaTrail: [via], identity: synthesisIdentity }];
  }
  return [allNameNothing(inner) ? namesNothingTerminal() : indeterminateTerminal()];
}

/**
 * Provenance of one argument of a wrapper call: the wrapper's `callee` name
 * and, when the argument is read through an import, the `{ specifier,
 * import }` pair of that import record. An argument that is not (a binding
 * declared in a file, an inline function) has no pair. Both via kinds that
 * describe a wrapped argument use it (`hoc-wrapper` when the wrapper folds to
 * the argument, `passed-as-argument` when the holder is its own identity and
 * the argument is seeded at its site), so the two name a binding identically.
 */
export function argumentProvenance(
  graph: Graph,
  type: Extract<InferredType, { kind: "ReturnTypeOf" }>,
  arg: InferredType,
  fileGraph: FileGraph,
): { callee: string; specifier?: string; import?: string } {
  const callee = deriveHocCallee(type.callee);
  const importRecord = findImportForLastArg(graph, arg, fileGraph);
  return importRecord ? { callee, specifier: importRecord.specifier, import: importRecord.imported } : { callee };
}

/**
 * Build the `hoc-wrapper` via for a ReturnTypeOf wrapper call. Shared by the
 * structural pass-through (step 2b), the pass-through recovery (step 3b) and
 * the opaque HOC fallback (step 4) so all three paths attribute composition
 * identically; the binding is named through `argumentProvenance`.
 */
function buildHocVia(
  graph: Graph,
  type: Extract<InferredType, { kind: "ReturnTypeOf" }>,
  lastArg: InferredType,
  fileGraph: FileGraph,
): OccurrenceVia {
  const { callee, ...binding } = argumentProvenance(graph, type, lastArg, fileGraph);
  return { kind: "hoc-wrapper", hocCallee: callee, ...binding };
}

/**
 * The argument a wrapper call folded to, and the `hoc-wrapper` hop the fold
 * recorded for it: the structural pass-through parameter when the callee has
 * one, else the last argument. The call's own JSX terminals confirm the
 * choice: every one must lead with a `hoc-wrapper` hop naming the same
 * callee and the same import (`sameHocVia`), which for an argument declared
 * in a file is the callee alone. Null otherwise: for a call with no
 * arguments, and for terminals that lead with something else or with nothing
 * at all (a lazy target, an algebra result, a dynamic-map dispatch).
 */
export function foldedArgument(
  graph: Graph,
  fileGraph: FileGraph,
  call: Extract<InferredType, { kind: "ReturnTypeOf" }>,
  jsx: readonly Terminal[],
  argMap: ArgumentMap,
): { arg: InferredType; via: OccurrenceVia } | null {
  const index = passThroughParameterIndex(graph, fileGraph, call, argMap, createCycleGuard()) ?? call.args.length - 1;
  const arg = call.args[index];
  if (arg === undefined || jsx.length === 0) return null;
  const via = buildHocVia(graph, call, arg, fileGraph);
  return jsx.every((t) => t.viaTrail[0] !== undefined && sameHocVia(t.viaTrail[0], via)) ? { arg, via } : null;
}

/** Two `hoc-wrapper` vias naming the same wrapper callee and the same import, or neither naming one. */
function sameHocVia(a: OccurrenceVia, b: OccurrenceVia): boolean {
  return (
    a.kind === "hoc-wrapper" &&
    b.kind === "hoc-wrapper" &&
    a.hocCallee === b.hocCallee &&
    a.specifier === b.specifier &&
    a.import === b.import
  );
}

/**
 * Stable comparison key for a TerminalIdentity. Mirrors the collapse rule in
 * `targetFromIdentity` (engine/index.ts) so pass-through detection keys
 * identities the same way they hash downstream: specifiers collapse to their
 * package name.
 */
function identityKey(id: TerminalIdentity): string {
  if (id === null) return "null";
  if (id.kind === "local") return JSON.stringify(["l", id.filePath, id.export]);
  const source = packageNameFromSpecifier(id.specifier) ?? id.specifier;
  return JSON.stringify(["i", source, id.imported]);
}

/**
 * A ReturnTypeOf is a pass-through (identity-preserving) wrapper when the
 * algebra reduced it to exactly the identity of its walked last argument: the
 * function returned its wrapped component (`c => c`). Every non-Unknown algebra
 * terminal's identity must appear in the last-arg walk; a wrapper whose body
 * returns a different component fails this and keeps its richer algebra result.
 */
function isPassThroughWrapper(algResult: readonly Terminal[], inner: readonly Terminal[]): boolean {
  const innerKeys = new Set(
    inner.filter((t) => !cameToNothing(t) && t.identity !== null).map((t) => identityKey(t.identity)),
  );
  const algKeys = algResult.filter((t) => !cameToNothing(t));
  // A null identity on either side is "no information", never a match:
  // null-equals-null folds a factory call onto its props-mapping or config argument.
  return algKeys.length > 0 && algKeys.every((t) => t.identity !== null && innerKeys.has(identityKey(t.identity)));
}

/**
 * Walker layered above `resolveType`. Applies three folding rules
 * (HOC last-arg fallback, lazy-import detection, dynamic-map fanout) and
 * accumulates a viaTrail + identity per terminal, without a mutable
 * parameter.
 *
 * For nodes where no folding rule applies, delegates to `resolveType`
 * (pure algebra) and computes identity from the input type's leaf TypeOf
 * when one can be confidently identified.
 */
export function walkWithFolding(
  graph: Graph,
  fileGraph: FileGraph,
  type: InferredType,
  argMap: ArgumentMap,
  guard: CycleGuard = createCycleGuard(),
  identityFallback?: InferredType,
  position: WalkPosition = "value",
): Evaluation {
  return atLeastOne(walkInner(graph, fileGraph, type, argMap, guard, identityFallback, position).map(published));
}

/** Where the walked value sits. At a `tag` it is what JSX renders, so a
 *  function is the component and the walk stops there; anywhere else it is a
 *  `value`, and a function is judged by what it returns. */
export type WalkPosition = "tag" | "value";

/**
 * The walk itself. Returns exactly what each arm produced, empty included:
 * inside the walk an empty result means "this branch contributed nothing",
 * which `walkTypeOf`'s vacuous `every` and `foldToWrappedArg`'s rescue both
 * read. Only the exported boundary above may substitute a terminal for it.
 *
 * `position` says whether `type` is what a tag renders. At a `tag`, a
 * function is one `callable` terminal and its body is not walked; the
 * position carries through the value hops (a reference, a union branch, a
 * static or dynamic member, a call's folded argument, a lazy target, a
 * dispatcher's returns) and nowhere else. In `value` position a function is
 * walked into its returns.
 */
function walkInner(
  graph: Graph,
  fileGraph: FileGraph,
  type: InferredType,
  argMap: ArgumentMap,
  guard: CycleGuard,
  // The identity `foldTerminals` falls back to when a terminal
  // carries no identity of its own (no `source`, no unreducible TypeOf/
  // DynamicImport leaf). Defaults to `type` (the walked node itself). The
  // `Function` arm below is the only place that overrides it: a component's
  // own return (`return priceElement;` or `return contactModals;`, a bare
  // JSX-value alias or a hook-return leaf) must keep deriving identity as
  // "nothing", so the engine's own fallback (the rendered declaration, e.g.
  // `OfferPrice`) wins over a same-file local alias like `priceElement`
  // that happens to sit in `foldTerminals`' fallback slot. Per-branch
  // identity from a fanout `source` (Union([TypeOf A, TypeOf B])) is
  // untouched: `source` is checked before this fallback in `foldTerminals`.
  identityFallback: InferredType | undefined,
  position: WalkPosition,
): readonly Walked[] {
  const fallback = identityFallback ?? type;
  switch (type.kind) {
    case "ReturnTypeOf":
      return walkReturnTypeOf(graph, fileGraph, type, argMap, guard, position);
    case "MemberOf":
      if (type.member === DYNAMIC_MEMBER_KEY) {
        return walkDynamicMember(graph, fileGraph, type, argMap, guard, position);
      }
      return walkStaticMember(graph, fileGraph, type, argMap, guard, fallback, position);
    case "Function":
      // At a tag the function is what JSX renders: one `callable` terminal
      // with no identity of its own, and the body is not walked.
      //
      // In value position a component's own returns can contain a nested
      // ReturnTypeOf/MemberOf (`List = ({items}) => items.map(render)`) that
      // needs wrapper-folding's steps (the opaque-callee / dynamic-map
      // handling below), not `resolveType`'s plain algebra: `resolveType`'s
      // own "Function" case recurses via plain `resolveType`, which never
      // re-enters this walk, so a value resolving to such a Function would
      // silently produce zero terminals.
      // Mirrors `resolveType`'s "Function" case, one level up. This Function
      // is the identity fallback for every return: a Function is never
      // TypeOf/DynamicImport, so `deriveIdentity` on it is always null.
      if (position === "tag") return [{ denotation: { kind: "callable" }, identity: null, viaTrail: [] }];
      return type.returns
        .flatMap((r) => walkInner(graph, fileGraph, r, argMap, guard, type, "value"))
        .map(returnedValue);
    case "TypeOf":
      return walkTypeOf(graph, fileGraph, type, argMap, guard, fallback, position);
    case "Union":
      // Structural re-entry: each branch walks through the walker so
      // a TypeOf branch reaches `walkTypeOf` and decides its own identity
      // (per-branch attribution) while a bare JSX branch (a lowered
      // ternary/logical render body) derives from the outer fallback.
      return type.types.flatMap((branch) => walkInner(graph, fileGraph, branch, argMap, guard, fallback, position));
    case "ParameterOf":
      return walkParameter(graph, fileGraph, type, argMap, guard, fallback);
    case "DynamicImport":
    case "Object":
    case "Array":
    case "JSX":
    case "Str":
    case "Unknown":
      return foldLeaf(graph, fileGraph, type, argMap, guard, fallback);
    default:
      return assertNever(type);
  }
}

/**
 * A parameter. Bound by the call the walk is inside, `resolveType`
 * substitutes the argument and the walk continues into it.
 * Unbound, the value is supplied by whoever calls this function later, which
 * is a different fact from "nothing is known": the algebra flattens both to
 * `Unknown`, and only the render site acts on the difference.
 */
function walkParameter(
  graph: Graph,
  fileGraph: FileGraph,
  type: Extract<InferredType, { kind: "ParameterOf" }>,
  argMap: ArgumentMap,
  guard: CycleGuard,
  fallback: InferredType,
): readonly Walked[] {
  const leaf = foldLeaf(graph, fileGraph, type, argMap, guard, fallback);
  if (boundArgument(argMap, type) !== undefined) return leaf;
  return leaf.map(asLateBound("parameter"));
}

/**
 * The leaf fold: pure algebra, then identity synthesis through
 * `foldTerminals`. Every structural kind (TypeOf, Union, MemberOf, Function,
 * ReturnTypeOf) has its own arm above and re-enters `walkInner` instead.
 */
function foldLeaf(
  graph: Graph,
  fileGraph: FileGraph,
  type: InferredType,
  argMap: ArgumentMap,
  guard: CycleGuard,
  fallback: InferredType,
): Walked[] {
  return foldTerminals(graph, fileGraph, resolveType(graph, fileGraph, type, argMap, guard), fallback);
}

/**
 * The file graph a Function walks in: its authoring file's. A Function
 * declared in another module must walk in that module's graph, because the
 * walker's file-scoped lookups inside it (a dynamic map's binding through
 * `findMapBinding`, an import table) only resolve where the code was
 * written: a cross-module `function getMapped(k) { return MAP[k]; }`
 * walked in the caller's fileGraph misses `MAP` entirely and loses the
 * `dynamic-map` hop. `walkDispatcherReturns` and `walkTypeOf` call it.
 * Falls back to the caller's graph when the file is absent or unindexed.
 */
function fileGraphForFunction(
  graph: Graph,
  fileGraph: FileGraph,
  fn: Extract<InferredType, { kind: "Function" }>,
): FileGraph {
  return fn.enclosingBinding?.file && fn.enclosingBinding.file !== fileGraph.filePath
    ? (graph.files.get(fn.enclosingBinding.file) ?? fileGraph)
    : fileGraph;
}

/**
 * The file a DynamicImport's specifier resolves against: the file that
 * contains the `import()`, whichever file the walk is standing in.
 */
function fileGraphForDynamicImport(
  graph: Graph | undefined,
  di: Extract<InferredType, { kind: "DynamicImport" }>,
  fallback: FileGraph,
): FileGraph {
  if (!graph || di.originFile === fallback.filePath) return fallback;
  return graph.files.get(di.originFile) ?? fallback;
}

/** The export a lazy target names: its projection's first member, else `default`. */
function dynamicImportName(di: Extract<InferredType, { kind: "DynamicImport" }>): string {
  return di.projection[0] ?? "default";
}

/**
 * The binding a lazy target names: its specifier's projected export, from the
 * file that contains the `import()`.
 */
export function dynamicImportBinding(
  graph: Graph,
  fileGraph: FileGraph,
  di: Extract<InferredType, { kind: "DynamicImport" }>,
): Binding {
  const origin = fileGraphForDynamicImport(graph, di, fileGraph);
  return resolveModuleExport(graph, origin.filePath, di.specifier, dynamicImportName(di), []);
}

/**
 * Structural re-entry for a reference. Resolves one
 * hop and walks the resolved value through `walkInner`, so every walker
 * rule (wrapper hops, dynamic maps, `.map()` bodies) applies through an
 * alias exactly as at a direct render site. `resolveType` alone never comes
 * back to the walk, so a map-bodied `List` reached via `MAP[k]` would come to
 * nothing.
 *
 * Identity: a terminal that comes back with no identity of its own is
 * stamped with this reference's identity only when the reference names a
 * component-shaped value (`evalKind === "component"`) or, at a tag, when the
 * walk came back with an identity-less `callable`: a reference to a function,
 * or to a wrapper call over an anonymous one, names what the tag renders,
 * whatever it returns. A reference to a JSX value (`return priceElement`) or
 * to a parameter binding stays null so the outer fallback wins, by
 * construction rather than by special case. A stamp naming a declaration with
 * no member chain carries that declaration (`bindingIdentity`).
 *
 * An import the graph cannot see (`resolved` is Unknown) is not re-entered:
 * it is the identity-bearing leaf `foldLeaf` synthesises from, and
 * `foldToWrappedArg`'s rescue relies on that shape.
 *
 * Cross-file: a Function authored elsewhere walks in its own file graph
 * (`fileGraphForFunction`, as in `walkDispatcherReturns`), so file-scoped
 * lookups inside it (a dynamic map's binding) resolve where they were written.
 *
 * Cycle guard: mirrors `resolveType`'s node guard. `const A = B; const B = A`
 * is legal JS and would otherwise re-enter forever.
 */
function walkTypeOf(
  graph: Graph,
  fileGraph: FileGraph,
  type: Extract<InferredType, { kind: "TypeOf" }>,
  argMap: ArgumentMap,
  guard: CycleGuard,
  fallback: InferredType,
  position: WalkPosition,
): readonly Walked[] {
  if (guard.pushNode(type) === "cycle") {
    return [indeterminateTerminal()];
  }
  try {
    const resolved = resolveReference(graph, fileGraph, type.ref, guard);
    if (resolved.kind === "Unknown") {
      // Pop before delegating: foldLeaf re-enters `resolveType`, which pushes
      // this same node onto the guard's path again. Leaving it pushed here
      // would self-collide as a spurious cycle (guard tracks by object
      // identity) on every import-backed leaf, not just real cycles. The
      // `finally` below still runs (a no-op double pop) once this returns.
      guard.popNode(type);
      return foldLeaf(graph, fileGraph, type, argMap, guard, fallback);
    }
    const innerGraph =
      resolved.kind === "Function" ? fileGraphForFunction(graph, fileGraph, resolved) : fileGraph;
    const inner = walkInner(graph, innerGraph, resolved, argMap, guard, fallback, position);
    if (inner.every((t) => t.identity !== null)) return inner;
    const derived =
      (position === "tag" && inner.some((t) => t.identity === null && isCallable(t))) ||
      (resolved.kind !== "ParameterOf" && evalKind(resolved, graph, innerGraph, argMap) === "component")
        ? deriveIdentity(type, fileGraph, graph)
        : null;
    const stamp = derived ?? deriveIdentity(fallback, fileGraph, graph);
    // Carries the product mark: a reference to a context is that context.
    return inner.map((t) =>
      t.identity === null && t.namesNothing !== true
        ? { denotation: t.denotation, viaTrail: t.viaTrail, identity: stamp, semantics: t.semantics }
        : t,
    );
  } finally {
    guard.popNode(type);
  }
}

/**
 * Static member access. Mirrors `walkDynamicMember` for one
 * named prop and without the `dynamic-map` hop: resolve the object, take the
 * member, walk the member's value through `walkInner`, so a wrapper
 * product stored in a map (`MAP.memo` → `memo(Button)`) reaches
 * `walkReturnTypeOf` and keeps its `hoc-wrapper` hop. Anything that is not an
 * in-graph Object (an Array, a parameter, a call's result) takes the leaf
 * fold. A member `reachMember` names a reference for (a recorded static
 * member, or a member of an import the graph cannot see) is walked as that
 * reference.
 *
 * Cycle guard: mirrors `walkTypeOf`. `const A = { Item: () => B.Item };
 * const B = { Item: () => A.Item }` is legal, loadable JS and the walk
 * re-enters this arm forever without it: `resolveType` pops every node it
 * pushes, so nothing on such a cycle stays on the guard's path otherwise.
 */
function walkStaticMember(
  graph: Graph,
  fileGraph: FileGraph,
  type: Extract<InferredType, { kind: "MemberOf" }>,
  argMap: ArgumentMap,
  guard: CycleGuard,
  fallback: InferredType,
  position: WalkPosition,
): readonly Walked[] {
  if (guard.pushNode(type) === "cycle") {
    return [indeterminateTerminal()];
  }
  try {
    const reached = reachMember(graph, fileGraph, type.obj, type.member, argMap, guard);
    if (reached.ref !== null) return walkInner(graph, fileGraph, { kind: "TypeOf", ref: reached.ref }, argMap, guard, fallback, position);
    const objects = reached.terminals
      .map((r) => r.type)
      .filter((t): t is Extract<InferredType, { kind: "Object" }> => t.kind === "Object");
    if (objects.length === 0) {
      // Pop before delegating: foldLeaf re-enters `resolveType`, which pushes
      // this same node onto the guard's path again. Leaving it pushed here
      // would self-collide as a spurious cycle (guard tracks by object
      // identity), not just on real cycles. The `finally` below still runs
      // (a no-op double pop) once this returns.
      guard.popNode(type);
      const leaf = foldLeaf(graph, fileGraph, type, argMap, guard, fallback);
      if (!(leaf.length > 0 && leaf.every(cameToNothing))) return leaf;
      // The object answers for the member: a prop read off a value supplied
      // elsewhere (`props.Icon`, `useThing()[0]`) is supplied elsewhere too,
      // and any member of a non-component product is that product. One walk
      // answers both, and only once the member came to nothing, so a member
      // that resolved is never re-walked.
      const object = walkInner(graph, fileGraph, type.obj, argMap, guard, undefined, "value");
      const semantics = markedProduct(object);
      if (semantics !== null) return leaf.map((t) => withSemantics(t, semantics));
      return evaluatesLateBound(object) ? leaf.map(asLateBound("parameter-member")) : leaf;
    }
    const out: Walked[] = [];
    for (const obj of objects) {
      const value = obj.props[type.member];
      if (value === undefined) continue;
      out.push(...walkInner(graph, fileGraph, value, argMap, guard, fallback, position));
    }
    return out.length > 0 ? out : [indeterminateTerminal()];
  } finally {
    guard.popNode(type);
  }
}

/**
 * A call. A call of an export the stub table names a non-component product
 * is that product, before any fold runs: its arguments are values the product
 * holds (a context's default), never a wrapped component, so none of them is
 * walked or credited.
 *
 * Every other call runs the folding rules first (`foldCall`). The call's own
 * shape gets a name only when all of them declined: no argument credited and no
 * algebra result. A call of a hook the graph cannot see returns a value
 * bound at render time by the hook's own implementation, so it is late-bound
 * rather than unknown. The predicate is React's `HOOK_NAME` over a callee
 * `isImportBackedLeaf` says the graph cannot resolve; it runs after the folds,
 * so `const X = useStyled(Base)` keeps the credit its fold gave it.
 *
 * Order matters: `returnedValue` runs on the fold's results before
 * `late-bound{hook-result}` is minted for the call itself.
 */
function walkReturnTypeOf(
  graph: Graph,
  fileGraph: FileGraph,
  type: Extract<InferredType, { kind: "ReturnTypeOf" }>,
  argMap: ArgumentMap,
  guard: CycleGuard,
  position: WalkPosition,
): Walked[] {
  const semantics = nonComponentProduct(graph, fileGraph, type.callee, guard);
  if (semantics !== null) return [withSemantics(indeterminateTerminal(), semantics)];
  const returns = foldCall(graph, fileGraph, type, argMap, guard, position).map(returnedValue);
  if (!(returns.length > 0 && returns.every(cameToNothing))) return returns;
  const unseenHook =
    HOOK_NAME.test(deriveHocCallee(type.callee)) && isImportBackedLeaf(type.callee, graph, fileGraph, guard);
  return unseenHook ? returns.map(asLateBound("hook-result")) : returns;
}

function foldCall(
  graph: Graph,
  fileGraph: FileGraph,
  type: Extract<InferredType, { kind: "ReturnTypeOf" }>,
  argMap: ArgumentMap,
  guard: CycleGuard,
  position: WalkPosition,
): Walked[] {
  // (1) lazy-import shape: any arg's subtree contains a DynamicImport
  //     (with one-ref-deep peek into local-file bindings to catch the async-await form).
  const lazyShape = findLazyImportArg(type.args, fileGraph);
  if (lazyShape) {
    // Walk the canonical DynamicImport directly (rather than the original arg
    // which may contain a MemberOf wrapper that confuses resolution).
    const syntheticDI: Extract<InferredType, { kind: "DynamicImport" }> = {
      kind: "DynamicImport",
      specifier: lazyShape.specifier,
      projection: lazyShape.projection,
      originFile: lazyShape.originFile,
    };
    const guardKey = `import()::${syntheticDI.specifier}::${syntheticDI.projection.join(".")}`;
    if (guard.push(syntheticDI.originFile, guardKey) !== "ok") {
      return [indeterminateTerminal()];
    }
    let inner: readonly Walked[];
    try {
      const target = resolveDynamicImportTarget(graph, fileGraph, syntheticDI);
      inner = target
        ? walkInner(graph, target.targetFileGraph, target.value, argMap, guard, undefined, position)
        : walkInner(graph, fileGraph, syntheticDI, argMap, guard, undefined, position);
    } finally {
      guard.pop(syntheticDI.originFile, guardKey);
    }
    const wrapperCallee = deriveHocCallee(type.callee);
    const importedName = dynamicImportName(syntheticDI);
    const via: OccurrenceVia = {
      kind: "lazy-import",
      wrapperCallee,
      specifier: lazyShape.specifier,
      import: importedName,
    };
    // A terminal keeps the identity its own fold produced; the import-derived
    // identity covers terminals that carry none.
    const binding = dynamicImportBinding(graph, fileGraph, syntheticDI);
    const identity: TerminalIdentity = walkedIdentity(graph, binding);
    const innerHasNonUnknown = inner.some((t) => !cameToNothing(t));
    if (innerHasNonUnknown) {
      return inner
        .filter((t) => !cameToNothing(t))
        .map((t) => ({
          denotation: t.denotation,
          viaTrail: [via, ...t.viaTrail],
          identity: t.identity ?? identity,
        }));
    }
    // External package: target not in graph. Also reached when the inner walk
    // was cut by the import cycle key above or by the depth budget, in which
    // case the import-derived identity is the answer. lazyShape still holds a
    // valid specifier and projection, so synthesize a `foreign` terminal
    // rather than an indeterminate one.
    if ((identity === null && isIndeterminateLeaf(binding)) || allNameNothing(inner)) return [namesNothingTerminal()];
    return [{ denotation: { kind: "foreign" }, viaTrail: [via], identity }];
  }

  // (2) Dispatcher detection: if the callee resolves to a Function
  // whose body returns a dynamic-map access (`return MAP[k]`), walk that body
  // via walkInner in the function's authoring fileGraph. This lets the
  // walkDynamicMember rule fire and surfaces the dynamic-map via in the chain,
  // which a cross-module dispatcher would otherwise lose.
  const dispatcherResult = walkDispatcherReturns(graph, fileGraph, type, argMap, guard, position);
  if (dispatcherResult) return dispatcherResult;

  // (2b) Structural pass-through. When every Function the callee resolves to
  // returns its own parameter (a bare `ParameterOf`, or a `TypeOf` that
  // resolves to one) bound by this call, the wrapper is identity-preserving by
  // construction (`c => c`); React's memo/forwardRef reach this arm through a
  // library stub table, regardless of import spelling (named, default, or
  // namespace). Fold straight to that argument and record the wrapper as a
  // hoc-wrapper hop. Decided from the callee's shape, never from whether the
  // algebra happened to succeed, so a local wrapped component and an external
  // one attribute identically. Folding goes through `foldToWrappedArg`, the
  // same tail step 4 uses, so both arms synthesise identity identically.
  const passThroughIndex = passThroughParameterIndex(graph, fileGraph, type, argMap, guard);
  if (passThroughIndex !== null) {
    const wrapped = type.args[passThroughIndex];
    if (wrapped !== undefined) {
      const inner = walkInner(graph, fileGraph, wrapped, argMap, guard, undefined, position);
      return foldToWrappedArg(inner, buildHocVia(graph, type, wrapped, fileGraph));
    }
  }

  // (3) Pure algebra walk. Per-leaf identity uses each terminal's source
  // (the leaf at the innermost fanout fork that produced it) so dynamic-map /
  // Union / Array fanouts attribute each branch to its own binding instead
  // of collapsing every leaf to the outer wrapper's identity.
  // foldTerminals also converts unreducible identity-bearing leaves into
  // synthesized `foreign` terminals, so a resolvable and an unresolvable imported
  // leaf take the same emission path.
  const algResult = foldTerminals(graph, fileGraph, resolveType(graph, fileGraph, type, argMap, guard), type);
  const algHasNonUnknown = algResult.some((r) => !cameToNothing(r));
  if (algHasNonUnknown) {
    // (3b) Pass-through HOC recovery. When the algebra reduces this call to the
    // identity of its wrapped last arg (an identity-preserving `c => c`
    // wrapper: withRouter/connect stubs, plus direct external-import calls the
    // leaf synthesis lets the algebra see through), the reduction flattened
    // the wrapper breadcrumb away. Recover it so a seen-through wrapper and an
    // opaque one (step 4) attribute composition identically: via presence
    // tracks the wrapper, not the algebra's reach. A wrapper whose body returns
    // a different component is not pass-through: the richer algebra result
    // stands with no via.
    const lastArg = type.args.at(-1);
    if (lastArg !== undefined) {
      const inner = walkInner(graph, fileGraph, lastArg, argMap, guard, undefined, position);
      if (isPassThroughWrapper(algResult, inner)) {
        const via = buildHocVia(graph, type, lastArg, fileGraph);
        return inner
          .filter((t) => !cameToNothing(t))
          .map((t) => ({ denotation: t.denotation, viaTrail: [via, ...t.viaTrail], identity: t.identity }));
      }
    }
    return algResult;
  }

  // (4) HOC fallback: algebra failed, last arg is the wrapper target.
  const lastArg = type.args.at(-1);
  if (lastArg === undefined) {
    return [indeterminateTerminal()];
  }
  // A data-method callback and a loader holding an `import()` the lazy arm
  // declined are called, not rendered, so they walk in value position.
  const dataMethod = isDataMethodRenderCall(type, graph, fileGraph, guard);
  const called = dataMethod || isLoader(lastArg, graph, fileGraph, guard);
  const inner = walkInner(graph, fileGraph, lastArg, argMap, guard, undefined, called ? "value" : position);
  // A data-method render call (`items.map(render)`) is not a
  // wrapper: its result is the callback's rendered JSX, not a component
  // received as a prop. Return the callback's terminals as they are: no
  // `hoc-wrapper` hop, and identity stays null so the engine's own fallback
  // (the declaration being walked, e.g. `List`) wins rather than whatever
  // the callback itself happened to resolve to. Import-backed MemberOf
  // callees (`Sentry.withProfiler`) fall through to the fold+hop below.
  if (dataMethod) {
    const nonUnknown = inner.filter((t) => !cameToNothing(t));
    if (nonUnknown.length > 0) {
      return nonUnknown.map((t) => ({ denotation: t.denotation, viaTrail: t.viaTrail, identity: null }));
    }
    return [indeterminateTerminal()];
  }
  return foldToWrappedArg(inner, buildHocVia(graph, type, lastArg, fileGraph));
}

/**
 * Index of the argument an identity-preserving wrapper returns, or null when
 * the callee is not structurally pass-through. Pass-through means: every
 * Function the callee resolves to has ≥1 return, every return reduces (bare, or
 * a `TypeOf` resolved one hop) to a `ParameterOf` whose `fn` is the ref this
 * call binds args to (`bindingRef`), and every return names the same index.
 * Unions, JSX, nested Functions or an unresolvable callee all yield null so the
 * algebra / opaque-HOC paths handle them instead.
 */
function passThroughParameterIndex(
  graph: Graph,
  fileGraph: FileGraph,
  type: Extract<InferredType, { kind: "ReturnTypeOf" }>,
  argMap: ArgumentMap,
  guard: CycleGuard,
): number | null {
  const calleeFns = resolveToFunctions(graph, fileGraph, type.callee, argMap, guard);
  if (calleeFns.length === 0) return null;
  let index: number | null = null;
  for (const { fn, bindingRef } of calleeFns) {
    if (fn.kind !== "Function" || bindingRef === null || fn.returns.length === 0) return null;
    const boundKey = argumentRefKey(bindingRef);
    for (const ret of fn.returns) {
      // The parser lowers `(C) => C` to a TypeOf return whose ref names the
      // parameter binding; the ParameterOf lives on that binding's declaration
      // in the function's body scope. Resolve one hop so real parser output
      // reaches this arm.
      const leaf = ret.kind === "TypeOf" ? resolveReference(graph, fileGraph, ret.ref, guard) : ret;
      if (leaf.kind !== "ParameterOf") return null;
      if (argumentRefKey(leaf.fn) !== boundKey) return null;
      if (index !== null && index !== leaf.index) return null;
      index = leaf.index;
    }
  }
  return index;
}

/**
 * Cross-module dispatcher walk. When the callee of a ReturnTypeOf
 * resolves to a Function whose body returns a `MemberOf-DYNAMIC` access
 * (the canonical `function getMapped(k) { return MAP[k]; }` shape), the
 * dynamic-map fanout lives across a module boundary from the call site.
 * `resolveType` alone would walk those returns in the caller's fileGraph
 * (missing MAP entirely), and walkDynamicMember would never see the pattern
 * so no `dynamic-map` via would land in the chain.
 *
 * This helper detects the shape and walks each function's returns through
 * `walkInner` in the function's authoring fileGraph (via
 * `enclosingBinding.file`). Returns null when no callee matches the shape so
 * the caller falls through to the pure algebra path.
 */
function walkDispatcherReturns(
  graph: Graph,
  fileGraph: FileGraph,
  type: Extract<InferredType, { kind: "ReturnTypeOf" }>,
  argMap: ArgumentMap,
  guard: CycleGuard,
  position: WalkPosition,
): Walked[] | null {
  const calleeFns = resolveToFunctions(graph, fileGraph, type.callee, argMap, guard);
  const hasDispatcher = calleeFns.some(
    ({ fn }) => fn.kind === "Function" && fn.returns.some(isDynamicMemberReturn),
  );
  if (!hasDispatcher) return null;

  const folded: Walked[] = [];
  for (const { fn, bindingRef } of calleeFns) {
    if (fn.kind !== "Function") continue;
    const fnFileGraph = fileGraphForFunction(graph, fileGraph, fn);
    if (bindingRef) argMap.bind(bindingRef, type.args);
    try {
      for (const ret of fn.returns) {
        folded.push(...walkInner(graph, fnFileGraph, ret, argMap, guard, undefined, position));
      }
    } finally {
      if (bindingRef) argMap.unbind(bindingRef);
    }
  }
  const hasNonUnknown = folded.some((t) => !cameToNothing(t));
  if (!hasNonUnknown) return null;
  return folded.filter((t) => !cameToNothing(t));
}

function isDynamicMemberReturn(t: InferredType): boolean {
  return t.kind === "MemberOf" && t.member === DYNAMIC_MEMBER_KEY;
}

/**
 * Detect whether any arg's subtree contains a DynamicImport, with one-ref-deep
 * peek into local-file declarations for the async-await form.
 * Returns the arg + the specifier + projection of the first DynamicImport found.
 */
function findLazyImportArg(
  args: InferredType[],
  fileGraph: FileGraph,
): { specifier: string; projection: string[]; originFile: string } | null {
  for (const arg of args) {
    const di = findFirstDynamicImport(arg, fileGraph, /*depthBudget=*/ 1);
    if (di) return di;
  }
  return null;
}

const PROMISE_METHODS = new Set(["then", "catch", "finally"]);

/** The crediting finder: narrow by design, and the only one that may claim a
 *  projection. `firstDynamicImport` (`engine/component-shape.ts`) is the
 *  reporting inverse: it descends everything and names a specifier only for
 *  the diagnostic. */
function findFirstDynamicImport(
  t: InferredType,
  fileGraph: FileGraph,
  depthBudget: number,
): { specifier: string; projection: string[]; originFile: string } | null {
  if (t.kind === "DynamicImport") {
    return { specifier: t.specifier, projection: t.projection, originFile: t.originFile };
  }
  if (t.kind === "Function") {
    for (const r of t.returns) {
      const hit = findFirstDynamicImport(r, fileGraph, depthBudget);
      if (hit) return hit;
    }
    return null;
  }
  if (t.kind === "ReturnTypeOf" && t.callee.kind === "MemberOf" && PROMISE_METHODS.has(t.callee.member)) {
    // `catch`/`finally` keep the import's value; a `then` the parser did not
    // collapse cannot name an export, so the import stays unclaimed.
    return t.callee.member === "then" ? null : findFirstDynamicImport(t.callee.obj, fileGraph, depthBudget);
  }
  if (t.kind === "MemberOf") {
    if (PROMISE_METHODS.has(t.member)) return null;
    // Descend into obj; if the inner result is a bare namespace DynamicImport
    // (projection=[]), append this member as the named-export projection so
    // that the async-await form `m.X` where `m = DynamicImport("./foo", [])`
    // produces projection:["X"] instead of projection:[].
    const inner = findFirstDynamicImport(t.obj, fileGraph, depthBudget);
    if (inner && t.member !== "" && inner.projection.length === 0) {
      return { specifier: inner.specifier, projection: [t.member], originFile: inner.originFile };
    }
    return inner;
  }
  if (t.kind === "TypeOf" && depthBudget > 0) {
    // One-ref-deep peek: look up the local binding and check its value.
    for (const [, decl] of fileGraph.declarations) {
      if (decl.symbol === t.ref.symbol) {
        return findFirstDynamicImport(decl.value, fileGraph, depthBudget - 1);
      }
    }
    return null;
  }
  return null;
}

/**
 * Cycle guard: mirrors `walkStaticMember`. A mutually-recursive object map
 * reached through `MAP[k]` re-enters this arm forever without it. No
 * `foldLeaf` path here, so no early pop is needed.
 */
function walkDynamicMember(
  graph: Graph,
  fileGraph: FileGraph,
  type: Extract<InferredType, { kind: "MemberOf" }>,
  argMap: ArgumentMap,
  guard: CycleGuard,
  position: WalkPosition,
): Walked[] {
  if (guard.pushNode(type) === "cycle") {
    return [indeterminateTerminal()];
  }
  try {
    const objResults = resolveType(graph, fileGraph, type.obj, argMap, guard);
    const out: Walked[] = [];
    for (const { type: obj } of objResults) {
      if (obj.kind !== "Object") continue;
      const mapBinding = findMapBinding(type.obj, fileGraph);
      const mapName = mapBinding?.symbol ?? "unknown";
      const mapLoc = {
        file: fileGraph.filePath,
        line: mapBinding?.loc.line ?? 0,
        column: mapBinding?.loc.column ?? 0,
      };
      for (const propValue of Object.values(obj.props)) {
        // Recurse via walkInner so identity is derived from each branch's
        // leaf TypeOf (Foo/Bar resolve to their respective bindings).
        const inner = walkInner(graph, fileGraph, propValue, argMap, guard, undefined, position);
        const via: OccurrenceVia = { kind: "dynamic-map", mapName, mapLoc };
        for (const t of inner) {
          if (cameToNothing(t)) continue;
          out.push({
            denotation: t.denotation,
            viaTrail: [via, ...t.viaTrail],
            identity: t.identity, // per-branch identity, distinct per map value
          });
        }
      }
    }
    return out;
  } finally {
    guard.popNode(type);
  }
}

function findMapBinding(
  obj: InferredType,
  fileGraph: FileGraph,
): { symbol: string; loc: { line: number; column: number } } | null {
  if (obj.kind !== "TypeOf") return null;
  for (const [, decl] of fileGraph.declarations) {
    if (decl.symbol === obj.ref.symbol) {
      return { symbol: decl.symbol, loc: decl.loc };
    }
  }
  return null;
}

/**
 * Walk down a callee chain to find the innermost TypeOf and return its symbol.
 * Handles plain identifiers (`connect`), member access (`React.memo`), and
 * curried calls (`connect()(...)`).
 */
function deriveHocCallee(callee: InferredType): string {
  switch (callee.kind) {
    case "TypeOf":
      return callee.ref.symbol;
    case "MemberOf":
      return callee.member !== "" ? callee.member : deriveHocCallee(callee.obj);
    case "ReturnTypeOf":
      return deriveHocCallee(callee.callee);
    default:
      return "unknown";
  }
}

/**
 * The import record the last arg's outermost TypeOf is read through, in the
 * file the reference was written in (`bindingImport`). Null when the last arg
 * isn't a TypeOf, or its name is declared in scope or not imported.
 */
function findImportForLastArg(
  graph: Graph,
  lastArg: InferredType,
  fileGraph: FileGraph,
): { specifier: string; imported: string } | null {
  let cur: InferredType = lastArg;
  while (cur.kind === "ReturnTypeOf") cur = cur.callee;
  if (cur.kind !== "TypeOf") return null;
  const imp = bindingImport(graph, fileGraph, cur.ref);
  return imp ? { specifier: imp.specifier, imported: imp.imported } : null;
}

/** The binding a `TypeOf` reference or a `DynamicImport` names. */
function leafBinding(
  graph: Graph,
  fileGraph: FileGraph,
  type: Extract<InferredType, { kind: "TypeOf" | "DynamicImport" }>,
): Binding {
  return type.kind === "DynamicImport"
    ? dynamicImportBinding(graph, fileGraph, type)
    : resolveBinding(graph, fileGraph, type.ref);
}

/**
 * The identity a walk credits for the binding a `TypeOf` reference or a
 * `DynamicImport` names (`walkedIdentity`: an unparsed file pinned to its
 * definition). Any other shape, a `ReturnTypeOf` included, has no identity
 * of its own and yields null.
 */
export function deriveIdentity(
  type: InferredType,
  fileGraph: FileGraph,
  graph: Graph,
): TerminalIdentity {
  // A ReturnTypeOf never derives identity from its callee:
  // a resolvable factory call's identity is the declaration holding the call,
  // which every engine push site already supplies as its fallback. Returning
  // null here is what makes that fallback win.
  if (type.kind === "DynamicImport" || type.kind === "TypeOf") return walkedIdentity(graph, leafBinding(graph, fileGraph, type));
  return null;
}
