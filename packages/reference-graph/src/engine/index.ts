import type { Graph, FileGraph, JsxUsage, TagUsage, BindingDecl, ImportRecord, Reference, InferredType } from "../index.js";
import type { Dialect, UsageKind } from "../types/file-graph.js";
import type { OccurrenceVia } from "../types/occurrence-via.js";
import type { ChainBailedCode, Known, PropValueState, UnresolvedReason } from "@scoutui/scan-format";
import { parseCompoundExport } from "@scoutui/scan-format";
import type { DiagnosticCollector } from "../diagnostics.js";
import { asTagName, canonicalTagName, isValidCustomElementName } from "../tag-name.js";
import { serialiseComponentId, type ComponentId, type ExternalSource } from "../types/component-id.js";
import { projectPropUsages } from "./project-props.js";
import { MODULE_SCOPE } from "../index.js";
import { createArgumentMap, type ArgumentMap } from "./argument-map.js";
import { walkWithFolding, argumentProvenance, foldedArgument, type TerminalIdentity } from "./wrapper-folding.js";
import { packageNameFromSpecifier, externalSubpath } from "./specifier.js";
import { buildHelperCallers, type ClassifiedHelperIndex } from "./helper-callers.js";
import {
  bindingIdentity,
  bindingImport,
  bindingValue,
  declarationPosition,
  declarationPositionIn,
  findLocalDeclaration,
  memberWrittenDeclarations,
  pinUnparsed,
  resolveBinding,
  resolveModuleExport,
  unresolvedPackageExport,
  walkedIdentity,
  type Binding,
} from "./binding.js";
import { assertNever } from "./assert-never.js";
import { ownershipOf, resolveOwnerChain } from "./owner-resolution.js";
import { createCycleGuard } from "./cycle-detection.js";
import { compoundExportName, memberOfObjectPath } from "./member-identity.js";
import { buildComponentRegistry, excludeFoldedHolders, excludeHostElementNames, entryKey, type ComponentRegistry, type FoldedHolder } from "./registry.js";
import { hasOnlyHostElementNames, isHostElementName, HOOK_NAME } from "./host-element.js";
import { firstDynamicImport } from "./component-shape.js";
import { creditedTerminals, isCallable, renderOutcome, type Evaluation, type Terminal } from "./denotation.js";

/** The fields every engine occurrence carries, resolved or not. */
type EngineOccurrenceBase = {
  filePath: string;
  line: number;
  column: number;
  /** Outermost access pattern (alias for viaChain[0]). */
  via: OccurrenceVia;
  /** Full provenance chain, outermost-first. Single-element for direct imports. */
  viaChain: OccurrenceVia[];
  props: Record<string, PropValueState>;
  /** Event names bound at this usage (Vue native events). Empty array
   *  when the usage carries none. */
  events: string[];
  /** Names one located use credited to one target under one owner: the
   *  serialised componentId (or `unresolved:` + `writtenRef`), file, line,
   *  column and serialised owner. The engine drops a repeat of a key; the
   *  scan file's `occurrenceId` is computed separately when it is written. */
  occurrenceKey: string;
  /** Declaration position for local-scope identities. */
  definition?: { line: number; column: number };
  /** The enclosing component's identity. The scan file names it by its own id (`ownerComponentId`). */
  rawOwnerComponentId?: ComponentId;
  /** The reference a JSX-style usage renders through, with its member path (`Filters.FilterBar`). Every occurrence
   *  the usage emits carries it; tag usages and argument sites carry none. */
  writtenName?: string;
};

/** Full occurrence shape produced by the engine.
 *
 *  A resolved occurrence's `rawComponentId` carries the structured
 *  `ComponentId` (`types/component-id.ts`); the CLI names it as the scan file's
 *  identity when it writes the file.
 *
 *  An unresolved occurrence is a render or an argument credit whose
 *  reference resolves to no component: it carries the `UnresolvedReason` and `writtenRef`, the
 *  reference as written (the import specifier and name, the unbound name, or
 *  the written tag).
 */
export type EngineOccurrence =
  | (EngineOccurrenceBase & { rawComponentId: ComponentId; unresolved?: undefined })
  | (EngineOccurrenceBase & { rawComponentId?: undefined; unresolved: Known<UnresolvedReason>; writtenRef: string });

export type ResolvedGraph = {
  occurrences: EngineOccurrence[];
  /** The component registry this resolution judged identities against.
   *  The CLI's roster join (`buildComponentSeeds`) reads it. */
  registry: ComponentRegistry;
};

/**
 * What the host's re-export chain walk says an external import resolves to:
 * - the leaf package, the public entry the import chain crossed into it by
 *   (the entry specifier's subpath after its own package name, through
 *   `externalSubpath`; `""` for the root entry) and the name exported at that
 *   entry;
 * - `bailed`, when the walk gave up on the chain;
 * - null, when the import resolves into the importing file's own package or
 *   does not resolve.
 */
export type ExternalLeafResult =
  | { leafPackage: string; publicEntry: string; exportName: string }
  | { bailed: ChainBailedCode }
  | null;

/**
 * Options for the `resolve` engine pass.
 */
export type ResolveOpts = {
  /**
   * Optional external leaf resolver. Called when an external React
   * or Vue component identity is constructed, with the importing graph file,
   * the import specifier that produced the identity, and the export name.
   * When the host's re-export chain walk lands in a different package, the
   * returned leaf replaces the specifier-derived identity: the package is the
   * leaf, `publicEntry` is the entry the chain crossed into it by and the
   * export is the name exported there. Same-package hits are ignored (identity already
   * correct). A `bailed` walk makes the reference an unresolved
   * `chain-bailed` occurrence. The engine imports no resolver types, only
   * this return shape.
   */
  resolveExternalLeaf?: (fromFile: string, specifier: string, exportName: string) => ExternalLeafResult;
  /**
   * Sink for engine-emitted diagnostics: `unresolved-reference`,
   * `late-bound-render` and `lazy-import-unsupported` for a JSX render that
   * produced no occurrence. When omitted, diagnostics are dropped.
   */
  collector?: Pick<DiagnosticCollector, "emit">;
};

/**
 * A bare element name JSX compiles to a string (`isHostElementName`: `div`,
 * `svg`, `web-button`, `X-Card`). On a React tag it is an intrinsic element,
 * never evaluated as a binding: a valid custom element name once canonical
 * (`web-button`, `X-Card`) is a tag occurrence, any other name (`div`) is the
 * host element and is never credited or reported. A member chain
 * (`motion.div`) or a capitalised identifier is a component reference.
 */
function isHostElementRoot(ref: Reference): boolean {
  return ref.memberChain.length === 0 && isHostElementName(ref.symbol);
}

export function resolve(graph: Graph, opts?: ResolveOpts): ResolvedGraph {
  const occurrences: EngineOccurrence[] = [];
  const argMap = createArgumentMap();
  // The walk reads no registry, owner or helper index, so every JSX tag is
  // evaluated once here, before the registry; the registry reads the
  // declarations the tags landed on as functions, and the render loop below
  // reads the result.
  const tagEvaluations = new Map<string, TagEvaluation[]>();
  for (const [filePath, fileGraph] of graph.files) {
    tagEvaluations.set(
      filePath,
      fileGraph.jsxUsages.map((usage) => evaluateJsxUsage(graph, fileGraph, usage, argMap)),
    );
  }
  // The registry is the one judge of component-ness: every declaration a
  // tag landed on as a function is a member. Owner classification asks it
  // (through the host-element narrowing, so a lowercase member is a helper
  // for ownership while the base registry still gates the argument-site
  // holder loop below).
  const registry = buildComponentRegistry(graph, taggedDeclarations(graph, tagEvaluations));
  const helperIndex = buildHelperCallers(graph, excludeHostElementNames(registry, graph));

  // The admission rule: a local react-component identity pinned to a
  // first-party path outside the graph (an unparsed first-party file, such as
  // a lazy `import("./PhoneInput")` whose target file wasn't walked) is
  // rejected when that path has an extension that is provably not code
  // (`hero.png`, `.SVG`). An extensionless path (`./PhoneInput` resolved
  // without a suffix) is admitted: it's far more likely an unwalked source
  // file than a non-code asset, and this rule can't tell without walking it.
  // Every other identity is admitted: the evaluator decides at the tag, and
  // argument sites and non-`callable` local tag credits ask the registry's
  // component judge (`registryHolds`).
  const CODE_EXT = /\.(?:[cm]?[jt]sx?|vue)$/i;
  const HAS_EXT = /\.[^./\\]+$/;
  const admit = (id: ComponentId): boolean => {
    if (id.kind !== "react-component" || id.source.type !== "local") return true;
    const { filePath } = id.source;
    if (graph.files.has(filePath)) return true;
    return !HAS_EXT.test(filePath) || CODE_EXT.test(filePath);
  };

  // Parallel sidecar holding the per-file usage index and kind of each
  // emitted occurrence, read by the hook-argument pass below to find the
  // credits of a JSX usage. Held off-band (not on `EngineOccurrence`) so
  // scratch state can't leak into output. A `null` slot means the occurrence
  // came from no usage: the argument-site seeding pass stamps nothing for its
  // occurrences.
  const composition: Array<{ fileUsageIdx: number; kind: UsageKind } | null> = [];

  // Finalise the occurrences emitted by one usage (the slice since
  // `lengthBefore`): collapse duplicates, then record the usage in the
  // `composition` sidecar. Called after each per-usage emit so helper-call
  // fanout (multiple occurrences per usage) records the same usage across the
  // fan.
  //
  // Dedup: an `occurrenceKey` (componentId + file + line + column + owner)
  // names one located use credited to one target under one owner, so it is
  // emitted once per resolve and the first emission is kept. Within a slice,
  // one evaluation can credit several terminals naming the same identity: a
  // function walked as a value (an argument, a factory product the algebra
  // flattens) yields one per `return <JSX>` branch, and a same-identity
  // fan-out at a tag (`flag ? Card : Card`) one per branch. Across slices,
  // the parser gives a module-scope `const x = <Y/>` literal's usages to its
  // first read site and clones them for each later one, each owned by the
  // function that reads it, so two reads in one function repeat an id and
  // the first read in source order is kept.
  // The `composition` sidecar isn't populated for this slice until the stamp
  // loop below, so the compaction only touches `occurrences`.
  // The per-slice compaction (admission + dedup, plus whatever the caller's
  // `superseded` says another credit already pays for). A usage's slice (via
  // `stampComposition`) and each argument-site loop's slice below route
  // through it. Returns how many of the slice's occurrences were credited,
  // counting a repeat of an emitted id.
  const emittedOccurrenceKeys = new Set<string>();
  const compactSlice = (lengthBefore: number, superseded?: (occ: EngineOccurrence) => boolean): number => {
    let credited = 0;
    let write = lengthBefore;
    for (let read = lengthBefore; read < occurrences.length; read++) {
      const occ = occurrences[read];
      if (occ === undefined) continue;
      if (occ.rawComponentId !== undefined && !admit(occ.rawComponentId)) continue;
      if (superseded?.(occ)) continue;
      credited++;
      if (emittedOccurrenceKeys.has(occ.occurrenceKey)) continue;
      emittedOccurrenceKeys.add(occ.occurrenceKey);
      occurrences[write++] = occ;
    }
    occurrences.length = write;
    return credited;
  };

  const stampComposition = (
    lengthBefore: number,
    kind: UsageKind,
    fileUsageIdx: number,
    writtenName?: string,
  ): number => {
    const credited = compactSlice(lengthBefore);

    for (let i = lengthBefore; i < occurrences.length; i++) {
      const occ = occurrences[i];
      if (!occ) continue;
      if (writtenName !== undefined) occ.writtenName = writtenName;
      composition[i] = { fileUsageIdx, kind };
    }
    return credited;
  };

  for (const [filePath, fileGraph] of graph.files) {
    const evaluations = tagEvaluations.get(filePath) ?? [];
    for (let usageIdx = 0; usageIdx < fileGraph.jsxUsages.length; usageIdx++) {
      const usage = fileGraph.jsxUsages[usageIdx];
      const evaluated = evaluations[usageIdx];
      if (!usage || !evaluated) continue;
      const ownership = ownershipOf(fileGraph, "jsx", usageIdx);
      const lengthBefore = occurrences.length;
      if (evaluated.kind === "evaluated") {
        emitTagCredits(occurrences, graph, filePath, fileGraph, usage, ownership, evaluated.credits, helperIndex, registry, opts);
      } else if (evaluated.kind === "custom-element") {
        const tagUsage: TagUsage = { tagName: usage.ref.symbol, loc: usage.loc, props: usage.props, events: usage.events ?? [] };
        pushTagOccurrence(occurrences, filePath, tagUsage, ownership?.ownerSymbolRef ?? null, ownership?.viaOverride, graph, helperIndex);
      } else if (evaluated.kind === "unresolved") {
        const viaOverride = ownership?.viaOverride;
        emitOccurrence(
          occurrences,
          usageSite(filePath, usage),
          { unresolved: evaluated.reason, writtenRef: evaluated.writtenRef },
          usageOwners(graph, helperIndex, ownership?.ownerSymbolRef ?? null, viaOverride, filePath),
          [viaOverride ?? evaluated.outerVia],
        );
      }
      const writtenName = [usage.ref.symbol, ...usage.ref.memberChain].join(".");
      const credited = stampComposition(lengthBefore, "jsx", usageIdx, writtenName);
      if (credited === 0) reportDroppedRender(opts, filePath, usage, evaluated);
    }

    // Tag-usage resolution for Vue template references.
    for (let i = 0; i < fileGraph.tagUsages.length; i++) {
      const usage = fileGraph.tagUsages[i];
      if (!usage) continue;
      const ownershipEntry = ownershipOf(fileGraph, "tag", i);
      const tagLengthBefore = occurrences.length;
      pushTagOccurrence(
        occurrences,
        filePath,
        usage,
        ownershipEntry?.ownerSymbolRef ?? null,
        ownershipEntry?.viaOverride,
        graph,
        helperIndex,
      );
      stampComposition(tagLengthBefore, "tag", i);
    }
  }

  // Argument-site seeding. A module-scope registry member whose value is a
  // call (a wrapper product) is a *holder*. Its own fold decides everything:
  // when the fold reaches JSX and every terminal carries neither an identity
  // nor a `hoc-wrapper` hop, the holder is its own identity (the callee was
  // visible and built a new function) and credited none of its arguments, so
  // each argument of its call that resolves to a component (an identifier, or
  // one reached through a call-valued argument) gets one occurrence at the
  // identifier's own position, owned by the holder. A fold that carried an
  // identity credited an argument already and seeds nothing, so a site is
  // never counted twice. The registry gate keeps an unused, unexported holder
  // from owning anything (no phantom owner by construction). Runs after the
  // usage loops so a holder's slice never interleaves with a usage's; there is
  // no composition sidecar entry because an argument site comes from no usage.
  // The same fold answers membership. A holder whose every JSX terminal
  // carries an identity has credited another identity for every render: it is
  // the route to that identity, not a member. Collected here, applied once
  // through `excludeFoldedHolders` at the return below.
  const folded = new Map<string, FoldedHolder>();
  for (const [filePath, fileGraph] of graph.files) {
    if (fileGraph.dialect === "vue") continue;
    for (const decl of fileGraph.declarations.values()) {
      if (decl.scope !== MODULE_SCOPE || decl.value.kind !== "ReturnTypeOf") continue;
      if (!registry.hasLocal(filePath, decl.symbol)) continue;
      const holderJsx = creditedTerminals(walkWithFolding(graph, fileGraph, decl.value, argMap));
      const foldedAway = foldedHolder(holderJsx, filePath);
      if (foldedAway !== null) folded.set(entryKey(filePath, decl.symbol), foldedAway);
      const lengthBefore = occurrences.length;
      pushArgumentSiteOccurrences(occurrences, filePath, decl, decl.value, holderJsx, graph, fileGraph, argMap, registry, opts);
      compactSlice(lengthBefore);
    }
  }

  // Hook argument seeding. A component passed to a hook call inside a
  // top-level function body (`const [modal] = useModalHolder(Modal)`) is
  // used at that site: a hook's product is usually a value the caller
  // interpolates (`{modal}`), so no render site pays for the argument and the
  // "fold credited it already" reasoning does not apply. Same argument rules
  // and the same push seam as the holder loop; the owner is
  // the enclosing declaration through `resolveOwnerChain`, so a helper hook
  // fans the seed out to each caller with a `helper-call` hop. A hook is
  // named by `HOOK_NAME`, React's own `isHookName` predicate (rules-of-hooks
  // and the compiler); there is no structural signal for "hook".
  // One use, one credit: when a binding of the call's result is rendered
  // (`const C = useX(M); <C/>`) and that render credits the argument's
  // component under the same owner, the render is the credit and the
  // argument occurrence is dropped.
  //
  // The owner + target (`creditKey`) of every render credit, by
  // `${filePath}:${usageIdx}` of its JSX usage; built on the first hook call
  // that seeds anything.
  let renderCredits: Map<string, Set<string>> | undefined;
  const renderCreditsAt = (filePath: string, usageIdx: number): ReadonlySet<string> | undefined => {
    if (renderCredits === undefined) {
      renderCredits = new Map();
      for (let i = 0; i < occurrences.length; i++) {
        const slot = composition[i];
        const occ = occurrences[i];
        if (slot?.kind !== "jsx" || occ === undefined) continue;
        const key = `${occ.filePath}:${slot.fileUsageIdx}`;
        const credits = renderCredits.get(key) ?? new Set<string>();
        credits.add(creditKey(occ));
        renderCredits.set(key, credits);
      }
    }
    return renderCredits.get(`${filePath}:${usageIdx}`);
  };
  for (const [filePath, fileGraph] of graph.files) {
    if (fileGraph.dialect === "vue") continue;
    let productRenders: Map<string, number[]> | undefined;
    for (const bodyCall of fileGraph.bodyCalls) {
      if (!HOOK_NAME.test(bodyCall.callee.symbol) || bodyCall.args.length === 0) continue;
      const call: Extract<InferredType, { kind: "ReturnTypeOf" }> = {
        kind: "ReturnTypeOf",
        callee: { kind: "TypeOf", ref: bodyCall.callee },
        args: bodyCall.args,
      };
      const ownerRef: Reference = {
        symbol: bodyCall.ownerSymbol,
        scope: MODULE_SCOPE,
        memberChain: [],
        loc: { line: 0, column: 0 },
        originFile: filePath,
      };
      const owners = (): OccurrenceOwner[] => chainOwners(graph, helperIndex, ownerRef);
      const lengthBefore = occurrences.length;
      pushCallArgumentOccurrences(occurrences, filePath, call, owners, graph, fileGraph, argMap, registry, opts);
      if (occurrences.length === lengthBefore) continue;
      productRenders ??= callProductRenders(fileGraph);
      const rendered = new Set<string>();
      for (const usageIdx of productRenders.get(locKey(bodyCall.callee.loc)) ?? []) {
        for (const credit of renderCreditsAt(filePath, usageIdx) ?? []) rendered.add(credit);
      }
      compactSlice(lengthBefore, (occ) => rendered.has(creditKey(occ)));
    }
  }

  return { occurrences, registry: excludeHostElementNames(excludeFoldedHolders(registry, folded), graph) };
}

/**
 * Build a local-scope ComponentId for a symbol declared in `filePath`.
 * Used for both the occurrence's own identity and for owner attribution.
 *
 * `fileDialect` is the dialect of the file that declares the symbol, not the
 * file referencing it. For an owner that is the file containing the owner
 * declaration; the caller looks up that FileGraph and passes its dialect.
 */
function makeLocalComponentId(
  filePath: string,
  symbol: string,
  fileDialect: Dialect,
): ComponentId {
  return {
    kind: componentKindFor(fileDialect),
    export: symbol,
    source: { type: "local", filePath },
  };
}

/**
 * Look up the dialect for a file referenced as an owner-declaration source.
 * Falls back to `"react"` when the file isn't in the graph.
 */
function dialectForFile(graph: Graph, filePath: string): Dialect {
  return graph.files.get(filePath)?.dialect ?? "react";
}

/**
 * Owner ComponentId for a parser-pre-decided owner reference (the
 * prop-forward path). `fallbackFile` is the consuming file, used when the ref
 * carries no originFile.
 *
 * This and `ownerIdFromResolution` build every occurrence's
 * `rawOwnerComponentId`: the dialect comes from the declaring file, not the
 * consumer's (`tests/engine/dialect-widening.test.ts`).
 */
function ownerIdFromRef(
  graph: Graph,
  ownerRef: Reference | null,
  fallbackFile: string,
): ComponentId | undefined {
  if (!ownerRef) return undefined;
  const file = ownerRef.originFile ?? fallbackFile;
  return makeLocalComponentId(file, ownerRef.symbol, dialectForFile(graph, file));
}

/**
 * Owner ComponentId for a resolved owner-chain result (helper-call fanout
 * paths). See `ownerIdFromRef` for the declaring-file-dialect invariant.
 */
function ownerIdFromResolution(
  graph: Graph,
  ownerDecl: { file: string; symbol: string } | undefined,
): ComponentId | undefined {
  if (!ownerDecl) return undefined;
  return makeLocalComponentId(ownerDecl.file, ownerDecl.symbol, dialectForFile(graph, ownerDecl.file));
}

/**
 * Context for the external-leaf relabel: what `targetFromIdentity` needs to
 * decide and apply it. Every caller that can produce an external React or Vue
 * component identity passes this instead of calling `relabelExternalLeaf`
 * itself.
 */
type RelabelContext = {
  /** The consuming file, passed to `resolveExternalLeaf` as `fromFile`. */
  filePath: string;
  /**
   * Specifier to use when the folded terminal's identity is null (fallback
   * componentId returned) and that fallback is itself external (e.g.
   * `evaluateJsxUsage`'s not-in-graph sentinel credit). Callers whose
   * fallback is always local omit it: the relabel no-ops on non-external
   * identities.
   */
  fallbackSpecifier?: string;
  resolveExternalLeaf?: ResolveOpts["resolveExternalLeaf"];
};

/**
 * The occurrence target for a folded terminal's identity hint: its reason
 * when the identity is a package export that names no component
 * (`unresolvedTarget`), else its ComponentId. When identity is null, fall back
 * to the caller's default (the usage's own import or local symbol).
 *
 * External-package imports populate `publicEntry` from the specifier subpath
 * (e.g. `@shoelace/dist/components/button` → `publicEntry: "dist/components/button"`)
 * so per-subpath components stay distinct.
 *
 * The component kind is derived from `fileDialect` via `componentKindFor`:
 * `"vue"` dialect files emit `vue-component`, all others emit `react-component`.
 * Tag-usage paths emit `custom-element` directly and don't call this helper.
 *
 * When `ctx` is supplied, this also applies the external-leaf relabel
 * (`relabelExternalLeaf`). The specifier fed to the relabel hook is the
 * folded terminal's own specifier when `identity`
 * is `"imported"` (it may diverge from the consuming file's own import
 * specifier, e.g. an in-graph barrel re-wrap), falling back to
 * `ctx.fallbackSpecifier` only when `identity` is null. Every call site that
 * can produce an external React or Vue component identity must pass `ctx`.
 */
function targetFromIdentity(
  identity: TerminalIdentity,
  fallback: ComponentId,
  fileDialect: Dialect,
  ctx?: RelabelContext,
): OccurrenceTarget {
  const unresolved = unresolvedTarget(identity);
  if (unresolved !== null) return unresolved;
  const rawComponentId = buildComponentId(identity, fallback, fileDialect);
  if (ctx === undefined) return { rawComponentId };
  const specifier = identity !== null && identity.kind === "imported" ? identity.specifier : ctx.fallbackSpecifier;
  if (specifier === undefined) return { rawComponentId };
  return relabelExternalLeaf(rawComponentId, ctx.filePath, specifier, ctx.resolveExternalLeaf);
}

/**
 * A name the host asks the engine to denote outside a render: a module-scope
 * binding of a parsed file, or the export `imported` of `specifier` as
 * `fromFile` imports it.
 */
export type DenotedName =
  | { kind: "binding"; filePath: string; symbol: string }
  | { kind: "export"; fromFile: string; specifier: string; imported: string };

/**
 * The component a name denotes: the shared declaration answer
 * (`walkedIdentity`) through `targetFromIdentity`, external-leaf relabel
 * included. `unresolved` for a package export that
 * names no component; null when the name binds no declaration, unparsed
 * first-party file or package export.
 */
export function denoteName(
  graph: Graph,
  name: DenotedName,
  opts?: Pick<ResolveOpts, "resolveExternalLeaf">,
): { rawComponentId: ComponentId } | { unresolved: Known<UnresolvedReason> } | null {
  const filePath = name.kind === "binding" ? name.filePath : name.fromFile;
  const dialect = dialectForFile(graph, filePath);
  let identity: TerminalIdentity;
  if (name.kind === "binding") {
    const fileGraph = graph.files.get(name.filePath);
    if (fileGraph === undefined) return null;
    const ref: Reference = { symbol: name.symbol, scope: MODULE_SCOPE, memberChain: [], loc: { line: 0, column: 0 } };
    identity = walkedIdentity(graph, resolveBinding(graph, fileGraph, ref));
  } else {
    identity = walkedIdentity(graph, resolveModuleExport(graph, name.fromFile, name.specifier, name.imported, []));
  }
  if (identity === null) return null;
  // The fallback is read only for a null identity.
  const target = targetFromIdentity(identity, makeLocalComponentId(filePath, "", dialect), dialect, {
    filePath,
    resolveExternalLeaf: opts?.resolveExternalLeaf,
  });
  return "unresolved" in target ? { unresolved: target.unresolved } : target;
}

function buildComponentId(identity: TerminalIdentity, fallback: ComponentId, fileDialect: Dialect): ComponentId {
  if (identity === null) return fallback;
  const kind = componentKindFor(fileDialect);
  if (identity.kind === "local") {
    return {
      kind,
      export: identity.export,
      source: { type: "local", filePath: identity.filePath },
    };
  }
  // imported: a package export → external, with the subpath as publicEntry.
  return {
    kind,
    export: identity.imported,
    source: externalSource(packageNameFromSpecifier(identity.specifier) ?? identity.specifier, identity.specifier),
  };
}

/**
 * Build the external `ComponentSource` for an import specifier. Stamps
 * `publicEntry` with the subpath after the package name when one is present,
 * so subpath imports like `@shoelace/dist/components/button` stay distinct
 * from `/icon`. Bare package specs (`react`, `@org/pkg`) omit
 * publicEntry. Subpath derivation (including module-extension normalisation, so
 * `react/button` and `react/button.js` collapse to one identity) lives in the
 * `externalSubpath` seam.
 */
function externalSource(pkg: string, specifier: string): ExternalSource {
  const publicEntry = externalSubpath(pkg, specifier);
  return publicEntry !== undefined
    ? { type: "external", package: pkg, publicEntry }
    : { type: "external", package: pkg };
}

/**
 * Relabel an external React or Vue component identity to the leaf package its
 * re-export chain crosses into, keyed by the public entry it crossed by and
 * the name exported there. No-op unless the hook is supplied, the identity is
 * an external React or Vue component, and the walk crossed a package
 * boundary. A walk that bailed makes the reference unresolved
 * (`chain-bailed`). The relabeled `publicEntry` is the host's as given, which
 * the host has already derived through `externalSubpath`.
 */
function relabelExternalLeaf(
  rawComponentId: ComponentId,
  filePath: string,
  specifier: string,
  resolveExternalLeaf: ResolveOpts["resolveExternalLeaf"],
): OccurrenceTarget {
  if (
    resolveExternalLeaf === undefined ||
    rawComponentId.kind === "custom-element" ||
    rawComponentId.source.type !== "external"
  ) {
    return { rawComponentId };
  }
  // A compound export names a member of the package's root export;
  // the leaf walk resolves the root and the member chain is re-joined onto
  // whatever export the leaf calls it.
  const { root, path } = parseCompoundExport(rawComponentId.export);
  const leaf = resolveExternalLeaf(filePath, specifier, root);
  if (leaf === null) return { rawComponentId };
  if ("bailed" in leaf) {
    return {
      unresolved: { kind: "chain-bailed", code: leaf.bailed },
      writtenRef: writtenImport(specifier, rawComponentId.export),
    };
  }
  if (leaf.leafPackage === rawComponentId.source.package) return { rawComponentId };
  return {
    rawComponentId: {
      kind: rawComponentId.kind,
      export: compoundExportName(leaf.exportName, path),
      source:
        leaf.publicEntry === ""
          ? { type: "external", package: leaf.leafPackage }
          : { type: "external", package: leaf.leafPackage, publicEntry: leaf.publicEntry },
    },
  };
}

/** One owner of an occurrence, with the via hops it puts ahead of the chain. */
type OccurrenceOwner = { rawOwnerComponentId: ComponentId | undefined; viaPrefix: OccurrenceVia[] };

/** The call site an occurrence records: where it is and what it binds there. */
type OccurrenceSite = {
  filePath: string;
  line: number;
  column: number;
  props: Record<string, PropValueState>;
  events: string[];
};

/** What an occurrence names: a component, or why its reference names none. */
type OccurrenceTarget = { rawComponentId: ComponentId } | { unresolved: Known<UnresolvedReason>; writtenRef: string };

/** A target as one string: the serialised component, or `unresolved:` + the reference as written. */
function targetKey(target: OccurrenceTarget): string {
  return "rawComponentId" in target ? serialiseComponentId(target.rawComponentId) : `unresolved:${target.writtenRef}`;
}

function occurrenceKey(targetId: string, site: OccurrenceSite, ownerId: string | undefined): string {
  const base = `${targetId}|${site.filePath}|${site.line}|${site.column}`;
  return ownerId !== undefined ? `${base}|${ownerId}` : base;
}

/** An occurrence's owner and target as one string, shared by every credit of the same component under the same owner. */
function creditKey(occ: EngineOccurrence): string {
  const owner = occ.rawOwnerComponentId !== undefined ? serialiseComponentId(occ.rawOwnerComponentId) : "";
  return `${owner}\n${targetKey(occ)}`;
}

const locKey = (loc: { line: number; column: number }): string => `${loc.line}:${loc.column}`;

/**
 * The JSX usages of a file that render a binding of a call's result
 * (`const C = useX(M)`, `const [C] = useX(M)`, then `<C/>`), keyed by the
 * position of the call's callee (`locKey`).
 */
function callProductRenders(fileGraph: FileGraph): Map<string, number[]> {
  const callOf = new Map<BindingDecl, string>();
  for (const decl of fileGraph.declarations.values()) {
    let value = decl.value;
    while (value.kind === "MemberOf") value = value.obj;
    if (value.kind === "ReturnTypeOf" && value.callee.kind === "TypeOf") callOf.set(decl, locKey(value.callee.ref.loc));
  }
  const renders = new Map<string, number[]>();
  fileGraph.jsxUsages.forEach((usage, usageIdx) => {
    const decl = findLocalDeclaration(fileGraph, usage.ref);
    const call = decl !== null ? callOf.get(decl) : undefined;
    if (call !== undefined) renders.set(call, [...(renders.get(call) ?? []), usageIdx]);
  });
  return renders;
}

/**
 * The occurrence constructor: one occurrence per owner, `viaChain` being the
 * owner's prefix followed by `chain`. Every emission path calls it.
 */
function emitOccurrence(
  occurrences: EngineOccurrence[],
  site: OccurrenceSite,
  target: OccurrenceTarget,
  owners: readonly OccurrenceOwner[],
  chain: readonly [OccurrenceVia, ...OccurrenceVia[]],
  definition?: { line: number; column: number },
): void {
  const targetId = targetKey(target);
  for (const { rawOwnerComponentId, viaPrefix } of owners) {
    const viaChain: OccurrenceVia[] = [...viaPrefix, ...chain];
    occurrences.push({
      ...target,
      filePath: site.filePath,
      line: site.line,
      column: site.column,
      via: viaChain[0] ?? chain[0],
      viaChain,
      props: site.props,
      events: site.events,
      occurrenceKey: occurrenceKey(
        targetId,
        site,
        rawOwnerComponentId !== undefined ? serialiseComponentId(rawOwnerComponentId) : undefined,
      ),
      ...(definition !== undefined ? { definition } : {}),
      ...(rawOwnerComponentId !== undefined ? { rawOwnerComponentId } : {}),
    });
  }
}

function usageSite(filePath: string, usage: JsxUsage | TagUsage): OccurrenceSite {
  return {
    filePath,
    line: usage.loc.line,
    column: usage.loc.column,
    props: projectPropUsages(usage.props),
    events: usage.events ?? [],
  };
}

/** The owner chain of `ownerRef`, one owner per resolution with its `helper-call` prefix. */
function chainOwners(
  graph: Graph,
  helperIndex: ClassifiedHelperIndex,
  ownerRef: Reference | null,
): OccurrenceOwner[] {
  return resolveOwnerChain(ownerRef, graph, helperIndex, createCycleGuard()).map((res) => ({
    rawOwnerComponentId: ownerIdFromResolution(graph, res.ownerDecl),
    viaPrefix: res.viaPrefix,
  }));
}

/**
 * Owners of a JSX usage. A `viaOverride` means the parser pre-decided the
 * owner (prop-forward): one owner, no prefix. Otherwise the owner chain fans
 * out, each resolution contributing its `helper-call` prefix.
 */
function usageOwners(
  graph: Graph,
  helperIndex: ClassifiedHelperIndex,
  ownerRef: Reference | null,
  viaOverride: OccurrenceVia | undefined,
  fallbackFile: string,
): OccurrenceOwner[] {
  if (viaOverride !== undefined) {
    return [{ rawOwnerComponentId: ownerIdFromRef(graph, ownerRef, fallbackFile), viaPrefix: [] }];
  }
  return chainOwners(graph, helperIndex, ownerRef);
}

/** One credited terminal of a JSX tag and everything the render loop needs to
 *  name it, except the usage's owners and its `viaOverride`. */
type TagCredit = {
  terminal: Terminal;
  /** The identity of a terminal that carries none. */
  fallback: ComponentId;
  /** The specifier the external-leaf relabel reads when `fallback` applies. */
  fallbackSpecifier?: string;
  /** The chain head when the usage has no `viaOverride`. */
  outerVia: OccurrenceVia;
  /** The declaration position the occurrence carries; set only on a credit
   *  whose terminal has no identity. */
  definition?: { line: number; column: number };
  /** The declaration the tag renders: set only on a credit whose terminal
   *  has no identity, when the binding is a declaration with nothing left on
   *  its path. */
  declaration?: BindingDecl;
};

/** What one JSX usage's tag evaluates to. `evaluateJsxUsage` computes it once
 *  per usage; `taggedDeclarations` reads it for the registry and the render
 *  loop for emission. `credits` is empty when nothing is credited. */
type TagEvaluation =
  /** A bare React tag JSX renders as the intrinsic element whatever the
   *  name is bound to (`isHostElementRoot`). A Vue usage's reference names
   *  the script binding its tag resolved to, so it is never a host element. */
  | { kind: "host-element" }
  /** An intrinsic React tag whose canonical name is a valid custom element
   *  name: the intrinsic element is a custom element, resolved by its tag
   *  name. */
  | { kind: "custom-element" }
  /** A tag whose reference names no component: `outerVia` heads its chain
   *  when the usage has no `viaOverride`. */
  | { kind: "unresolved"; reason: Known<UnresolvedReason>; writtenRef: string; outerVia: OccurrenceVia }
  | { kind: "evaluated"; evaluation: Evaluation; value: InferredType | null; credits: readonly TagCredit[] };

/** An import as written, as an unresolved occurrence's `writtenRef`. */
function writtenImport(specifier: string, name: string): string {
  return `${specifier}#${name}`;
}

/** The tag's own import, as written, names no component, for `reason`. */
function unresolvedImport(imp: ImportRecord, reason: Known<UnresolvedReason>): TagEvaluation {
  return {
    kind: "unresolved",
    reason,
    writtenRef: writtenImport(imp.specifier, imp.imported),
    outerVia: { kind: "direct-import", specifier: imp.specifier, import: imp.imported },
  };
}

/** A Vue template tag whose name, as written (`Menu.Item`, `Named`),
 *  provably binds nothing: `unbound-name`, naming the whole tag. */
function unboundWrittenName(usage: JsxUsage, outerVia: OccurrenceVia): TagEvaluation {
  const name = [usage.ref.symbol, ...usage.ref.memberChain].join(".");
  return { kind: "unresolved", reason: { kind: "unbound-name", name }, writtenRef: name, outerVia };
}

/** A declaration binding's member path provably names nothing: no member
 *  write in the graph names the declaration (`memberWrittenDeclarations`),
 *  and the object-path walk stopped on an object literal or a function
 *  without `openMembers`. */
function provablyLacksMember(graph: Graph, binding: Extract<Binding, { kind: "declaration" }>): boolean {
  if (memberWrittenDeclarations(graph).has(binding.decl)) return false;
  const { stoppedOn } = memberOfObjectPath(binding.member?.value ?? binding.decl.value, binding.path);
  return (stoppedOn?.kind === "Object" || stoppedOn?.kind === "Function") && stoppedOn.openMembers !== true;
}

/** An occurrence target for an identity: its reason and written import when
 *  the identity is a package export that names no component, else null. */
function unresolvedTarget(identity: TerminalIdentity): OccurrenceTarget | null {
  if (identity?.kind !== "imported" || identity.unresolved === undefined) return null;
  return { unresolved: identity.unresolved, writtenRef: writtenImport(identity.specifier, identity.imported) };
}

/** A compound name (`NS.Member`) names a member of an object literal: the
 *  holder's value, followed down `path` (`memberOfObjectPath`), is an `Object`
 *  at every step and has the member. An empty path names the holder itself. */
function namesObjectMember(holder: InferredType | undefined, path: readonly string[]): boolean {
  return path.length === 0 || memberOfObjectPath(holder, path).member !== undefined;
}

/**
 * Evaluate one JSX usage's tag and name each credited terminal's fallback
 * identity, chain head and `definition`, from the binding the tag's reference
 * names. An intrinsic React tag (`isHostElementRoot`) is not evaluated: it is
 * `custom-element` when its canonical name is a valid custom element name,
 * else `host-element`. A Vue usage's reference names a binding, so the rule
 * does not apply to it.
 * Every walk here is in tag position.
 *
 * - A declaration walks its value, falling back to the binding's identity. A
 *   terminal with no identity of its own is credited under a compound
 *   fallback only when the declaration names an object member there
 *   (`namesObjectMember`).
 * - A package export and an unparsed first-party file, however the import
 *   reached them, are not walked: each credits a `foreign` sentinel that
 *   falls back to the external package, or to the file's definition
 *   (`pinUnparsed`), which carries the position the host located as its
 *   `definition`. A package export that names no component
 *   (`unresolvedPackageExport`) is `unresolved` instead.
 * - An undeclared, unimported name is `unresolved` as `unbound-name`; `this`
 *   is a keyword, never a name, so its value is walked. An imported name
 *   whose import fails, the usage's own or one a parsed file re-exports,
 *   is `unresolved` as `module-not-found`. A name unbound inside the parsed
 *   file its import reached, `unfollowed` and a React `no-export` walk their
 *   value.
 * - A Vue tag whose written name provably binds nothing is `unresolved` as
 *   `unbound-name` naming it as written (`unboundWrittenName`): a dotted tag
 *   whose head is a declaration that credits nothing and provably lacks the
 *   member (`provablyLacksMember`), and a tag whose import names an export
 *   its parsed module provably does not have (`no-export`). A React tag in
 *   either case credits nothing and reports `unresolved-reference`.
 */
function evaluateJsxUsage(
  graph: Graph,
  fileGraph: FileGraph,
  usage: JsxUsage,
  argMap: ArgumentMap,
): TagEvaluation {
  if (fileGraph.dialect === "react" && isHostElementRoot(usage.ref)) {
    return isValidCustomElementName(canonicalTagName(usage.ref.symbol)) ? { kind: "custom-element" } : { kind: "host-element" };
  }
  const binding = resolveBinding(graph, fileGraph, usage.ref);
  const imp = bindingImport(graph, fileGraph, usage.ref);
  const walkTag = (value: InferredType): Evaluation =>
    walkWithFolding(graph, fileGraph, value, argMap, createCycleGuard(), undefined, "tag");
  const walked = (): TagEvaluation => {
    const value = bindingValue(binding);
    return { kind: "evaluated", evaluation: walkTag(value), value, credits: [] };
  };
  switch (binding.kind) {
    case "unbound":
      return imp === undefined && usage.ref.symbol !== "this"
        ? {
            kind: "unresolved",
            reason: { kind: "unbound-name", name: usage.ref.symbol },
            writtenRef: usage.ref.symbol,
            outerVia: { kind: "local-component" },
          }
        : walked();
    case "import-failed":
      return imp !== undefined ? unresolvedImport(imp, { kind: "module-not-found" }) : walked();
    case "no-export":
      return fileGraph.dialect === "vue" && imp !== undefined
        ? unboundWrittenName(usage, { kind: "direct-import", specifier: imp.specifier, import: imp.imported })
        : walked();
    case "unfollowed":
      return walked();
    case "declaration": {
      const value = bindingValue(binding);
      const evaluation = walkTag(value);
      const named = bindingIdentity(binding);
      const fallback = makeLocalComponentId(named.filePath, named.export, fileGraph.dialect);
      const holder = binding.decl;
      const { member } = binding;
      const definition =
        binding.inScope || binding.path.length > 0 || member !== null ? declarationPosition(binding) : undefined;
      const rendered = binding.path.length === 0 && member === null ? { declaration: holder } : {};
      const namesMember = namesObjectMember(member?.value ?? holder.value, binding.path);
      const outerVia: OccurrenceVia =
        binding.inScope || imp === undefined
          ? { kind: "local-component" }
          : { kind: "direct-import", specifier: imp.specifier, import: imp.imported };
      const credits = creditedTerminals(evaluation)
        .filter((terminal) => terminal.identity !== null || namesMember)
        .map(
          (terminal): TagCredit => ({
            terminal,
            fallback,
            outerVia,
            ...(terminal.identity === null ? { ...(definition !== undefined ? { definition } : {}), ...rendered } : {}),
          }),
        );
      if (fileGraph.dialect === "vue" && credits.length === 0 && provablyLacksMember(graph, binding)) {
        return unboundWrittenName(usage, outerVia);
      }
      return { kind: "evaluated", evaluation, value, credits };
    }
    case "package-export":
    case "unparsed": {
      if (imp === undefined) return walked();
      const reason = binding.kind === "package-export" ? unresolvedPackageExport(graph, binding) : null;
      if (reason !== null) return unresolvedImport(imp, reason);
      const pinned = binding.kind === "unparsed" ? pinUnparsed(graph, binding) : binding;
      const definition = pinned.kind === "unparsed" ? pinned.definition : undefined;
      const sentinel: Terminal = { denotation: { kind: "foreign" }, viaTrail: [], identity: null };
      const fallback: ComponentId = {
        kind: componentKindFor(fileGraph.dialect),
        export: compoundExportName(pinned.exportName, pinned.path),
        source:
          pinned.kind === "unparsed"
            ? { type: "local", filePath: pinned.file }
            : externalSource(packageNameFromSpecifier(pinned.specifier) ?? pinned.specifier, pinned.specifier),
      };
      return {
        kind: "evaluated",
        evaluation: [sentinel],
        value: null,
        credits: [
          {
            terminal: sentinel,
            fallback,
            fallbackSpecifier: pinned.kind === "package-export" ? pinned.specifier : imp.specifier,
            outerVia: { kind: "direct-import", specifier: imp.specifier, import: imp.imported },
            ...(definition !== undefined ? { definition } : {}),
          },
        ],
      };
    }
    default:
      return assertNever(binding);
  }
}

/** The declaration a credit carries: its identity's tag-position stamp, else
 *  the render site's own binding for a credit with no identity. */
function carriedDeclaration(credit: TagCredit): BindingDecl | undefined {
  const { identity } = credit.terminal;
  if (identity === null) return credit.declaration;
  return identity.kind === "local" ? identity.declaration : undefined;
}

/** The declaration every local `react-component` identity a tag's walk
 *  landed on as a function carries (the terminal's own identity, else the
 *  render site's fallback, named as the render loop names it): the identity's
 *  stamp or the render site's binding. A credit that carries none marks
 *  nothing. */
function taggedDeclarations(
  graph: Graph,
  tagEvaluations: ReadonlyMap<string, readonly TagEvaluation[]>,
): BindingDecl[] {
  const tagged: BindingDecl[] = [];
  for (const [filePath, evaluations] of tagEvaluations) {
    const dialect = dialectForFile(graph, filePath);
    for (const evaluated of evaluations) {
      if (evaluated.kind !== "evaluated") continue;
      for (const credit of evaluated.credits) {
        if (!isCallable(credit.terminal)) continue;
        const { identity } = credit.terminal;
        const id = buildComponentId(identity, credit.fallback, dialect);
        if (id.kind === "react-component" && id.source.type === "local") {
          const declaration = carriedDeclaration(credit);
          if (declaration !== undefined) tagged.push(declaration);
        }
      }
    }
  }
  return tagged;
}

/** Push one usage's credited terminals: one occurrence per credit × owner,
 *  through the external-leaf relabel seam and `emitOccurrence`. A credit that
 *  is not `callable` is pushed only when `registryHolds` its identity, a
 *  `callable` one only when `registryTagged` its identity. */
function emitTagCredits(
  occurrences: EngineOccurrence[],
  graph: Graph,
  filePath: string,
  fileGraph: FileGraph,
  usage: JsxUsage,
  ownership: FileGraph["ownership"][number] | undefined,
  credits: readonly TagCredit[],
  helperIndex: ClassifiedHelperIndex,
  registry: ComponentRegistry,
  opts: ResolveOpts | undefined,
): void {
  if (credits.length === 0) return;
  const viaOverride = ownership?.viaOverride;
  const site = usageSite(filePath, usage);
  const owners = usageOwners(graph, helperIndex, ownership?.ownerSymbolRef ?? null, viaOverride, filePath);
  for (const credit of credits) {
    const chain: [OccurrenceVia, ...OccurrenceVia[]] =
      viaOverride !== undefined ? [viaOverride] : [credit.outerVia, ...credit.terminal.viaTrail];
    const target = targetFromIdentity(credit.terminal.identity, credit.fallback, fileGraph.dialect, {
      filePath,
      ...(credit.fallbackSpecifier !== undefined ? { fallbackSpecifier: credit.fallbackSpecifier } : {}),
      resolveExternalLeaf: opts?.resolveExternalLeaf,
    });
    if ("unresolved" in target) {
      emitOccurrence(occurrences, site, target, owners, chain);
      continue;
    }
    const { rawComponentId } = target;
    const declaration = carriedDeclaration(credit);
    const stands = isCallable(credit.terminal)
      ? registryTagged(registry, graph, rawComponentId, declaration)
      : registryHolds(registry, graph, rawComponentId, declaration);
    if (!stands) continue;
    const { identity } = credit.terminal;
    const definition = credit.definition ?? (identity?.kind === "local" ? identity.definition : undefined);
    emitOccurrence(occurrences, site, { rawComponentId }, owners, chain, definition);
  }
}

/**
 * The one reporter for a JSX usage that produced no occurrence. A host-element
 * tag reports nothing, and an unresolved tag always produces an occurrence. A
 * walked value holding an `import()` is `lazy-import-unsupported`, naming the
 * file the `import()` is declared in when that is not the render file; the
 * `import()` in the walked value is checked before the evaluation. Everything
 * the evaluation itself decides is `renderOutcome`'s: a value that is not a
 * component reports nothing, a value supplied elsewhere reports
 * `late-bound-render`, and anything else reports `unresolved-reference`,
 * including a credit the registry's judge, its tagged membership or admission
 * rejected (a render gives one occurrence or one diagnostic).
 */
function reportDroppedRender(
  opts: ResolveOpts | undefined,
  filePath: string,
  usage: JsxUsage,
  outcome: TagEvaluation,
): void {
  const collector = opts?.collector;
  if (collector === undefined) return;
  if (outcome.kind !== "evaluated") return;
  const at = { filePath, line: usage.loc.line, column: usage.loc.column };
  const positional = { ...at, symbol: usage.ref.symbol, memberChain: [...usage.ref.memberChain] };
  const di = outcome.value === null ? null : firstDynamicImport(outcome.value);
  if (di) {
    collector.emit({
      code: "lazy-import-unsupported",
      severity: "warning",
      ...at,
      specifier: di.specifier,
      detail: `the import() target could not be resolved to a component${
        di.originFile === filePath ? "" : ` (declared in ${di.originFile})`
      }`,
    });
    return;
  }
  const decided = renderOutcome(outcome.evaluation);
  if (decided.kind === "silent") return;
  if (decided.kind === "credit") {
    collector.emit({ code: "unresolved-reference", severity: "info", ...positional });
    return;
  }
  collector.emit({ code: decided.code, severity: "info", ...positional });
}

/**
 * A holder is folded away iff its fold reaches JSX and every JSX
 * terminal carries an identity: the fold credited someone else for every
 * render. Any identity-less terminal means the holder is its own identity
 * (`memo(makeControl(Base))`, `forwardRef((p, r) => <b/>)`).
 * The target is reported only when all terminals name one local member of
 * the holder's own file; that member inherits `isDefault` in
 * `excludeFoldedHolders`. Returns `null` when the holder is not folded.
 */
function foldedHolder(holderJsx: readonly Terminal[], filePath: string): FoldedHolder | null {
  if (holderJsx.length === 0 || holderJsx.some((t) => t.identity === null)) return null;
  const first = holderJsx[0]?.identity;
  const sameFileSingle =
    first !== undefined &&
    first !== null &&
    first.kind === "local" &&
    first.filePath === filePath &&
    holderJsx.every(
      (t) => t.identity !== null && t.identity.kind === "local" && t.identity.filePath === filePath && t.identity.export === first.export,
    );
  return { target: sameFileSingle ? { filePath, export: first.export } : null };
}

/**
 * Argument-site seeding for one holder over the fold the caller already ran
 * (the rule is stated at the call site in `resolve`). Identity goes through
 * `targetFromIdentity` (the external-leaf relabel) and the owner through
 * `ownerIdFromRef`, as on every other push path; the binding is named through
 * `argumentProvenance`, the same helper `hoc-wrapper` uses. The caller
 * compacts the slice (admission + dedup).
 */
function pushArgumentSiteOccurrences(
  occurrences: EngineOccurrence[],
  filePath: string,
  holder: BindingDecl,
  call: Extract<InferredType, { kind: "ReturnTypeOf" }>,
  holderJsx: readonly Terminal[],
  graph: Graph,
  fileGraph: FileGraph,
  argMap: ArgumentMap,
  registry: ComponentRegistry,
  opts?: ResolveOpts,
  depth = 0,
): void {
  // The holder is its own identity iff its fold reaches JSX and no terminal
  // carries an identity of its own or a `hoc-wrapper` hop. The hop is the
  // fold's own record that it credited an argument, even when that argument
  // was anonymous (`forwardRef((p, r) => <b/>, x)`), so the holder is a
  // wrapper of it and its other arguments are configuration, not wrapped
  // components. A wrapper that folded to a call (`memo(makeControl(Base))`)
  // hands that call over to be judged in the holder's place.
  const shape = callFoldShape(holderJsx);
  if (shape === "wrapper") {
    if (depth >= MAX_ARGUMENT_CALL_DEPTH || !call.args.some((a) => a.kind === "ReturnTypeOf")) return;
    const folded = foldedArgument(graph, fileGraph, call, holderJsx, argMap);
    if (folded?.arg.kind !== "ReturnTypeOf") return;
    const innerJsx = creditedTerminals(walkWithFolding(graph, fileGraph, folded.arg, argMap));
    pushArgumentSiteOccurrences(occurrences, filePath, holder, folded.arg, innerJsx, graph, fileGraph, argMap, registry, opts, depth + 1);
    return;
  }
  if (shape !== "product") return;

  const holderRef: Reference = {
    symbol: holder.symbol,
    scope: MODULE_SCOPE,
    memberChain: [],
    loc: holder.loc,
    originFile: filePath,
  };
  // The holder still seeds (its argument is a real usage), but a
  // declaration that can never be rendered under any of its names is not a
  // component and cannot own: the phantom-owner rule the registry gate in
  // `resolve` encodes, applied to the one owner this loop builds directly.
  const rawOwnerComponentId = hasOnlyHostElementNames(holder.symbol, fileGraph)
    ? undefined
    : ownerIdFromRef(graph, holderRef, filePath);
  pushCallArgumentOccurrences(occurrences, filePath, call, () => [{ rawOwnerComponentId, viaPrefix: [] }], graph, fileGraph, argMap, registry, opts, depth);
}

/** Calls below the outermost one that argument seeding descends through. */
const MAX_ARGUMENT_CALL_DEPTH = 2;

/**
 * What a call's fold says about the call, from its JSX terminals. A
 * `product` is its own identity: no terminal carries an identity or a
 * `hoc-wrapper` hop, so the fold credited none of its arguments. A `wrapper`
 * credited an argument on every terminal. Null when the fold reaches no JSX
 * or its terminals disagree.
 */
function callFoldShape(jsx: readonly Terminal[]): "product" | "wrapper" | null {
  if (jsx.length === 0) return null;
  const credited = jsx.filter((t) => t.identity !== null || t.viaTrail.some((v) => v.kind === "hoc-wrapper")).length;
  if (credited === 0) return "product";
  return credited === jsx.length ? "wrapper" : null;
}

/** A local identity declared in a parsed React-dialect file is a component
 *  only when the registry's judge says its declaration is one (`declaration`
 *  when the credit carries it); the declaring file's dialect decides, not the
 *  identity's kind. Any other identity is not the registry's to judge. */
function registryHolds(registry: ComponentRegistry, graph: Graph, id: ComponentId, declaration?: BindingDecl): boolean {
  if (id.kind === "custom-element" || id.source.type !== "local") return true;
  if (graph.files.get(id.source.filePath)?.dialect !== "react") return true;
  return registry.isComponent(id.source.filePath, id.export, declaration);
}

/** A local, non-compound `react-component` identity declared in a parsed
 *  React-dialect file is what a `callable` credit names only when tagged
 *  membership marked the declaration the credit carries (`isTagged`). Any
 *  other identity is not the registry's to judge. */
function registryTagged(registry: ComponentRegistry, graph: Graph, id: ComponentId, declaration?: BindingDecl): boolean {
  if (id.kind !== "react-component" || id.source.type !== "local") return true;
  if (graph.files.get(id.source.filePath)?.dialect !== "react") return true;
  if (parseCompoundExport(id.export).isCompound) return true;
  return registry.isTagged(declaration);
}

/**
 * The argument-site push: one `passed-as-argument` occurrence per
 * (identifier argument that resolves to a component) × (owner). The
 * module-scope holder loop and the hook loop in `resolve` both call it.
 *
 * A call's own arguments only: the arguments of a call in its callee chain
 * configure the wrapper (`compose(withRouter, withTheme)(Foo)`), they are
 * not wrapped. An identifier argument is resolved through the walker so
 * aliases, re-exports and import-backed leaves take the same path a render
 * site does; a null identity is skipped, never invented. An identifier that
 * is a host-element name (`useSelector(pick, shallowEqual)`) can never be
 * rendered as a component, whatever it resolves to: an external leaf has
 * no shape to check and would otherwise synthesise a component out of any
 * import. The parser's held references and the roster naming gate apply the
 * same predicate (`isHostElementName`). A local identity declared in a React
 * file is seeded only when the registry's component judge accepts its
 * declaration (`registryHolds`).
 *
 * A call-valued argument is followed by what its own fold says
 * (`callFoldShape`), at most `MAX_ARGUMENT_CALL_DEPTH` calls below the
 * outermost one. A wrapper is followed to the argument its fold credited
 * (`foldedArgument`), and the hop joins the chain after `passed-as-argument`.
 * A product becomes the site: its own arguments are seeded and the hops
 * start again. A call whose fold reaches no JSX is configuration. Any other
 * argument kind is skipped.
 *
 * `owners` is resolved on the first push and reused: most hook calls
 * (`useState(x)`, `useEffect(fn, deps)`) never reach a push, and resolving
 * the owner chain for each of them is costly.
 */
function pushCallArgumentOccurrences(
  occurrences: EngineOccurrence[],
  filePath: string,
  call: Extract<InferredType, { kind: "ReturnTypeOf" }>,
  owners: () => OccurrenceOwner[],
  graph: Graph,
  fileGraph: FileGraph,
  argMap: ArgumentMap,
  registry: ComponentRegistry,
  opts?: ResolveOpts,
  depth = 0,
): void {
  type Call = Extract<InferredType, { kind: "ReturnTypeOf" }>;
  let resolvedOwners: OccurrenceOwner[] | undefined;

  const seedIdentifier = (site: Call, index: number, arg: Extract<InferredType, { kind: "TypeOf" }>, hops: OccurrenceVia[]): void => {
    if (isHostElementName(arg.ref.symbol)) return;
    const outerVia: OccurrenceVia = { kind: "passed-as-argument", index, ...argumentProvenance(graph, site, arg, fileGraph) };
    // Never applied: every terminal used below carries a non-null identity,
    // and `buildComponentId` returns the fallback only for a null one. The
    // relabel seam's signature requires a fallback all the same.
    const unusedFallback = makeLocalComponentId(filePath, arg.ref.symbol, fileGraph.dialect);
    const argSite: OccurrenceSite = { filePath, line: arg.ref.loc.line, column: arg.ref.loc.column, props: {}, events: [] };
    for (const ft of creditedTerminals(walkWithFolding(graph, fileGraph, arg, argMap))) {
      if (ft.identity === null) continue;
      const target = targetFromIdentity(ft.identity, unusedFallback, fileGraph.dialect, {
        filePath,
        resolveExternalLeaf: opts?.resolveExternalLeaf,
      });
      if ("unresolved" in target) {
        resolvedOwners ??= owners();
        emitOccurrence(occurrences, argSite, target, resolvedOwners, [outerVia, ...hops, ...ft.viaTrail]);
        continue;
      }
      const { rawComponentId } = target;
      if (!registryHolds(registry, graph, rawComponentId, ft.identity.kind === "local" ? ft.identity.declaration : undefined)) continue;
      resolvedOwners ??= owners();
      const { identity } = ft;
      let definition: { line: number; column: number } | undefined;
      if (identity.kind === "local") {
        const { root, path } = parseCompoundExport(identity.export);
        const at = identity.definition ?? identity.declaration?.loc ?? declarationPositionIn(graph, identity.filePath, root, path);
        definition = at !== undefined ? { line: at.line, column: at.column } : undefined;
      }
      emitOccurrence(occurrences, argSite, { rawComponentId }, resolvedOwners, [outerVia, ...hops, ...ft.viaTrail], definition);
    }
  };

  const seedArguments = (site: Call, siteDepth: number): void => {
    site.args.forEach((arg, index) => seedArgument(site, index, arg, [], siteDepth));
  };

  const seedArgument = (site: Call, index: number, arg: InferredType, hops: OccurrenceVia[], callDepth: number): void => {
    if (arg.kind === "TypeOf") {
      seedIdentifier(site, index, arg, hops);
      return;
    }
    if (arg.kind !== "ReturnTypeOf" || callDepth >= MAX_ARGUMENT_CALL_DEPTH) return;
    const argJsx = creditedTerminals(walkWithFolding(graph, fileGraph, arg, argMap));
    const shape = callFoldShape(argJsx);
    if (shape === "product") {
      seedArguments(arg, callDepth + 1);
      return;
    }
    if (shape !== "wrapper") return;
    const folded = foldedArgument(graph, fileGraph, arg, argJsx, argMap);
    if (folded !== null) seedArgument(site, index, folded.arg, [...hops, folded.via], callDepth + 1);
  };

  seedArguments(call, depth);
}

/**
 * The tag-name identity: a custom element as written, of unknown source. Which
 * package or repository declaration provides a tag is its attribution, which
 * the CLI computes from the scan's evidence.
 */
function tagComponentId(tagName: string): ComponentId {
  return { kind: "custom-element", tagName: asTagName(tagName), source: { type: "unknown" } };
}

/**
 * Push the occurrences for a tag usage (a Vue template tag or a React
 * custom-element tag) under its `tagComponentId` identity, owned as a JSX
 * usage is (`usageOwners`).
 *
 * The owner's kind comes from the dialect of the file the owner declaration
 * lives in (`dialectForFile`): a Vue SFC's tag-usage owner is
 * `vue-component`, a React file's owner is `react-component`. The tag
 * usage's own `rawComponentId.kind` stays `"custom-element"` whatever the
 * consumer's dialect.
 */
function pushTagOccurrence(
  occurrences: EngineOccurrence[],
  filePath: string,
  usage: TagUsage,
  ownerRef: Reference | null,
  viaOverride: OccurrenceVia | undefined,
  graph: Graph,
  helperIndex: ClassifiedHelperIndex,
): void {
  const via: OccurrenceVia = viaOverride ?? { kind: "html-tag" };
  const owners = usageOwners(graph, helperIndex, ownerRef, viaOverride, filePath);
  emitOccurrence(occurrences, usageSite(filePath, usage), { rawComponentId: tagComponentId(usage.tagName) }, owners, [via]);
}

/** JSX-emission ComponentId kinds. Excludes `"custom-element"`, which only
 *  TagUsage paths emit, whatever the dialect. */
type JsxComponentKind = "react-component" | "vue-component";

/**
 * Decide the `kind` for a JSX-emitted ComponentId. A concrete
 * `manifestKindHint` is used verbatim; otherwise the file's dialect decides:
 * `"vue"` files emit `"vue-component"`, all others `"react-component"`. No
 * caller supplies a hint. Tag-usage paths (custom-element) don't call this
 * helper.
 */
function componentKindFor(
  fileDialect: Dialect,
  manifestKindHint?: JsxComponentKind,
): JsxComponentKind {
  if (manifestKindHint !== undefined) return manifestKindHint;
  return fileDialect === "vue" ? "vue-component" : "react-component";
}
