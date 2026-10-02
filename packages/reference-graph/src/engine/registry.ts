import type { BindingDecl, FileGraph, Graph, InferredType, Reference } from "../index.js";
import { MODULE_SCOPE } from "../index.js";
import { parseCompoundExport } from "@scoutui/scan-format";
import { bindingDeclaration, isDefaultExport, resolveBinding } from "./binding.js";
import { createCycleGuard } from "./cycle-detection.js";
import { evalKind } from "./component-shape.js";
import { hasOnlyHostElementNames } from "./host-element.js";
import { memberOfObjectPath } from "./member-identity.js";

/**
 * The registry of component declarations. Identity is a lookup
 * into this set, never a walk terminus. A declaration is a member iff it is
 * admitted-shaped (`isAdmittedShape`, below: `evalKind === "component"`, or
 * the component-namespace widening below) and consumed, or a tag's walk
 * landed on it as a function (`renderedAsTag`, supplied by `resolve()`'s tag
 * pre-pass as the declarations its credits carry; being rendered as a tag is
 * consumption).
 * Consumed means exported,
 * referenced by a JSX usage, or held: named by an identifier in value
 * position anywhere in the file (`FileGraph.heldRefs`, recorded by the
 * parser: a call argument, an object property value, an array element, an
 * assignment right-hand side, a return value, a JSX attribute or child
 * expression). Neither the usage nor the hold has to be at module scope:
 * each carries its scope, and the binding resolver (`resolveBinding`) names
 * the declaration it reaches, through a namespace member to the member's
 * declaration, and through a static member to its holder.
 *
 * Consumption is the gate that keeps `renderIcon()` helpers, render-less
 * classes and other component-shaped-but-inert declarations out of the
 * roster. Vue-dialect files contribute nothing: their
 * SFC declaration is not typed by this algebra and the engine admits their
 * identities unconditionally.
 *
 * A folded holding declaration (`export default memo(Foo)`, `const Enhanced =
 * connect()(Foo)`) is component-shaped and exported, so `buildComponentRegistry`
 * admits it; it is removed again by `excludeFoldedHolders` (below),
 * which `resolve()` applies from the one fold it already runs per call-valued
 * member, unless a tag rendered it. The registry never folds: membership is
 * `(consumed ∧ isAdmittedShape) ∨ renderedAsTag`.
 */
export type RegistryEntry = {
  filePath: string;
  symbol: string;
  exportName: string;
  kind: "react-component" | "vue-component";
  loc: { line: number; column: number };
  isDefault: boolean;
};

export type ComponentRegistry = {
  hasLocal(filePath: string, exportName: string): boolean;
  /** The component judge: is the declaration a local identity names a
   *  component? It is when it is admitted-shaped or a tag rendered it
   *  (`renderedAsTag`). The declaration is `declaration` when the caller
   *  carries one, else the one `findDeclaration` names. A compound name
   *  (`NS.Inline`) is judged by its holder's `Object` path and the member's
   *  shape. Consumption is not asked: the credit being judged is the
   *  consumption. */
  isComponent(filePath: string, name: string, declaration?: BindingDecl): boolean;
  /** Where the identity named by (filePath, symbol-or-exportedAs) is
   *  declared, and under which local symbol. A compound export (`NS.Inline`)
   *  names a member of a holder, not a declaration, and has none. */
  declarationOf(filePath: string, exportName: string): { symbol: string; loc: { line: number; column: number } } | undefined;
  /** Whether the declaration behind `entry` is one a tag's walk landed on as
   *  a function (`renderedAsTag`). */
  isRenderedAsTag(entry: RegistryEntry): boolean;
  /** Whether tagged membership marked `declaration`, the declaration a
   *  caller's local identity carries. None is marked when it carries none. */
  isTagged(declaration?: BindingDecl): boolean;
  localEntries(): readonly RegistryEntry[];
};

/**
 * A member the engine folded away: every render of it is credited
 * to another identity. `target` is that identity when it is a single local
 * member of the same file (it inherits `isDefault`); `null` otherwise
 * (external, other file, or a fan-out to several identities).
 */
export type FoldedHolder = { target: { filePath: string; export: string } | null };

/** The registry's key shape, shared with the engine's folded-holder map. */
export function entryKey(filePath: string, name: string): string {
  return `${filePath}::${name}`;
}

/**
 * A narrowed view over an existing registry: `localEntries()` and `hasLocal`
 * answer for `entries` only; `isComponent`, `declarationOf`,
 * `isRenderedAsTag` and `isTagged` are always delegated untouched: a narrowed-away member
 * is still declared where it was. Both roster narrowings (folded holders and
 * host-element names) construct their result here.
 */
function narrowTo(registry: ComponentRegistry, entries: readonly RegistryEntry[]): ComponentRegistry {
  const survivingNames = new Set<string>();
  for (const e of entries) {
    survivingNames.add(entryKey(e.filePath, e.symbol));
    survivingNames.add(entryKey(e.filePath, e.exportName));
  }
  return {
    hasLocal: (filePath, exportName) => survivingNames.has(entryKey(filePath, exportName)),
    isComponent: (filePath, name, declaration) => registry.isComponent(filePath, name, declaration),
    declarationOf: (filePath, exportName) => registry.declarationOf(filePath, exportName),
    isRenderedAsTag: (entry) => registry.isRenderedAsTag(entry),
    isTagged: (declaration) => registry.isTagged(declaration),
    localEntries: () => entries,
  };
}

/** `tagged`: every declaration a tag's walk landed on as a function
 *  (`callable`), as the render site or the identity's tag-position stamp
 *  resolved it in scope. */
export function buildComponentRegistry(graph: Graph, tagged: Iterable<BindingDecl> = []): ComponentRegistry {
  const consumed = new Set<string>(); // `${file}::${symbol}`
  const guard = createCycleGuard();

  // 1. Consumption: exports, JSX references, held values.
  for (const [file, fg] of graph.files) {
    for (const exp of fg.exports) {
      if ("local" in exp) consumed.add(entryKey(file, exp.local));
    }
    for (const decl of fg.declarations.values()) {
      if (decl.isExported || decl.exportedAs !== undefined) consumed.add(entryKey(file, decl.symbol));
    }
    const consume = (ref: Reference): void => {
      const target = bindingDeclaration(resolveBinding(graph, fg, ref, guard));
      if (target) consumed.add(entryKey(target.file, target.decl.symbol));
    };
    for (const usage of fg.jsxUsages) consume(usage.ref);
    for (const ref of fg.heldRefs) consume(ref);
  }

  // Each tagged declaration is marked; `isTagged` reads the marks.
  const renderedAsTag = new Set<BindingDecl>(tagged);
  const isTagged = (declaration?: BindingDecl): boolean => declaration !== undefined && renderedAsTag.has(declaration);

  // 2. Membership: consumed and component-shaped, or rendered as a tag. Among
  //    members sharing a name, the one `findDeclaration` resolves the name to
  //    takes the first one's entry, in its list position.
  const byKey = new Map<string, RegistryEntry>();
  const entryIndex = new Map<string, number>();
  const entries: RegistryEntry[] = [];
  const taggedEntries = new Set<string>();
  for (const [file, fg] of graph.files) {
    if (fg.dialect === "vue") continue;
    for (const decl of fg.declarations.values()) {
      const symbolKey = entryKey(file, decl.symbol);
      if (!renderedAsTag.has(decl) && !(consumed.has(symbolKey) && isAdmittedShape(decl.value, graph, fg))) continue;
      const exportName = decl.exportedAs ?? decl.symbol;
      const entry: RegistryEntry = {
        filePath: file,
        symbol: decl.symbol,
        exportName,
        kind: "react-component",
        loc: decl.loc,
        isDefault: isDefaultExport(fg, decl.symbol),
      };
      if (renderedAsTag.has(decl)) taggedEntries.add(declarationKey(entry));
      const key = entryKey(file, exportName);
      if (!byKey.has(key)) {
        entryIndex.set(key, entries.length);
        entries.push(entry);
      } else {
        const at = entryIndex.get(key);
        if (at !== undefined && findDeclaration(fg, exportName) === decl) entries[at] = entry;
      }
      byKey.set(entryKey(file, decl.symbol), entry);
      byKey.set(key, entry);
    }
  }

  // A compound name (`NS.Inline`) names a member of a holder declaration: the
  // holder is looked up by its root and the residual path walked through its
  // Object props. `parseCompoundExport` is the one reader of the dotted form;
  // `compoundExportName` the one writer.
  const judge = (fg: FileGraph, name: string, declaration: BindingDecl | undefined): boolean => {
    const { root, path } = parseCompoundExport(name);
    const decl = declaration ?? findDeclaration(fg, root);
    if (decl === undefined) return false;
    if (path.length > 0) return isAdmittedMember(decl.value, path, graph, fg);
    return isAdmittedShape(decl.value, graph, fg) || renderedAsTag.has(decl);
  };
  // Cached per (file, name) for name-only calls.
  const judgedByName = new Map<string, boolean>();
  const isComponent = (filePath: string, name: string, declaration?: BindingDecl): boolean => {
    const fg = graph.files.get(filePath);
    if (fg === undefined || fg.dialect === "vue") return false;
    if (declaration !== undefined) return judge(fg, name, declaration);
    const cacheKey = entryKey(filePath, name);
    const cached = judgedByName.get(cacheKey);
    if (cached !== undefined) return cached;
    const result = judge(fg, name, undefined);
    judgedByName.set(cacheKey, result);
    return result;
  };

  return {
    hasLocal: (filePath, exportName) => byKey.has(entryKey(filePath, exportName)),
    isComponent,
    declarationOf: (filePath, exportName) => declarationOf(graph, filePath, exportName),
    isRenderedAsTag: (entry) => taggedEntries.has(declarationKey(entry)),
    isTagged,
    localEntries: () => entries,
  };
}

/** `ComponentRegistry.declarationOf` over any graph's parsed files: where the
 *  identity named by (filePath, symbol-or-exportedAs) is declared, through
 *  `findDeclaration`. None for a Vue file or a compound export. */
export function declarationOf(
  graph: Graph,
  filePath: string,
  exportName: string,
): { symbol: string; loc: { line: number; column: number } } | undefined {
  const fg = graph.files.get(filePath);
  if (fg === undefined || fg.dialect === "vue") return undefined;
  const { root, isCompound } = parseCompoundExport(exportName);
  if (isCompound) return undefined;
  const decl = findDeclaration(fg, root);
  if (decl === undefined) return undefined;
  return { symbol: decl.symbol, loc: decl.loc };
}

/** One declaration's key: its file, symbol and position. */
function declarationKey(entry: RegistryEntry): string {
  return `${entryKey(entry.filePath, entry.symbol)}@${entry.loc.line}:${entry.loc.column}`;
}

/**
 * The roster registry after folded holders are removed. `resolve()`
 * computes `folded` from the fold it already runs per call-valued member;
 * this function never folds. A folded holder a tag
 * rendered as a function (`isRenderedAsTag`) is kept: the tag credits the
 * holder itself, and it hands nothing to its target. Any other
 * folded holder is absent from `localEntries()` and `hasLocal` says no for
 * its symbol and its export name; `isComponent` (the component judge) is
 * untouched.
 * A folded default holder hands `isDefault` to its same-file target.
 * The narrowed `hasLocal` answers only for names of surviving entries, so a
 * name the base registry knew only through its de-duplicated `byKey` (never
 * in `localEntries()`) answers false here. Owner classification and the
 * argument-site holder loop ask `hasLocal` before this narrowing; the CLI's
 * roster never asks it.
 */
export function excludeFoldedHolders(
  registry: ComponentRegistry,
  folded: ReadonlyMap<string, FoldedHolder>,
): ComponentRegistry {
  if (folded.size === 0) return registry;
  const inheritsDefault = new Set<string>();
  const survivors: RegistryEntry[] = [];
  for (const entry of registry.localEntries()) {
    const holder = folded.get(entryKey(entry.filePath, entry.symbol));
    if (holder === undefined || registry.isRenderedAsTag(entry)) {
      survivors.push(entry);
      continue;
    }
    if (entry.isDefault && holder.target !== null) {
      inheritsDefault.add(entryKey(holder.target.filePath, holder.target.export));
    }
  }
  const entries = survivors.map((e) =>
    inheritsDefault.has(entryKey(e.filePath, e.symbol)) || inheritsDefault.has(entryKey(e.filePath, e.exportName))
      ? { ...e, isDefault: true }
      : e,
  );
  return narrowTo(registry, entries);
}

/**
 * The roster naming gate: a member whose every renderable name is a
 * JSX host-element name is not a component. React's own rule (a bare
 * lowercase-initial name in tag position is an intrinsic element) means such
 * a binding can never be rendered under that name, whatever shape its value
 * has (`const dirname = path.dirname(url)` is an opaque wrapper, consumed by
 * `path.join(dirname, …)`, and would otherwise be a member).
 *
 * Applied at `resolve()`'s return, after `excludeFoldedHolders`, and never
 * inside `buildComponentRegistry`: the base registry's `hasLocal` also gates
 * the argument-site holder loop, so a lowercase holder
 * (`const wrap = withHarness(Button)`) is still walked and still credits
 * `Button` at its argument. Only the roster row goes away. Ordering matters:
 * a target that inherited `isDefault` from a folded default holder
 * is exempt, and that inheritance happens in the fold narrowing.
 *
 * The naming rule and its exemptions live in `hasOnlyHostElementNames`,
 * shared with owner classification. `isComponent` is untouched: JSX
 * cannot render a bare lowercase name, and a diagnostic is the residual
 * guard for any other path that lands an occurrence on one.
 */
export function excludeHostElementNames(registry: ComponentRegistry, graph: Graph): ComponentRegistry {
  const before = registry.localEntries();
  const entries = before.filter(
    (entry) => entry.isDefault || !hasOnlyHostElementNames(entry.symbol, graph.files.get(entry.filePath)),
  );
  if (entries.length === before.length) return registry;
  return narrowTo(registry, entries);
}

/**
 * A declaration is an admitted shape iff `evalKind === "component"`
 * or it is a "component namespace": an `Object`-valued declaration with at
 * least one prop that is itself component-shaped, e.g.
 * `export const Sidebar = { Root, Branch, Leaf }` rendered as
 * `<Sidebar.Root/>`. `evalKind` itself stays pure (an `Object` is always
 * "other" there); this widening lives only at the registry boundary, where
 * shape becomes the judge's and membership's decision.
 */
function isAdmittedShape(value: InferredType, graph: Graph, fg: FileGraph): boolean {
  if (evalKind(value, graph, fg) === "component") return true;
  if (value.kind !== "Object") return false;
  return Object.values(value.props).some((prop) => evalKind(prop, graph, fg) === "component");
}

/**
 * The member a compound export names. Walk `path` through nested
 * `Object` props from the holder's value (`memberOfObjectPath`); the terminal
 * value must be admitted-shaped (a component, or itself a component
 * namespace). Any step that is not an `Object` prop, or a missing prop, is
 * not a member.
 */
function isAdmittedMember(holder: InferredType, path: readonly string[], graph: Graph, fg: FileGraph): boolean {
  const { member } = memberOfObjectPath(holder, path);
  return member !== undefined && isAdmittedShape(member, graph, fg);
}

/**
 * The identity-name → declaration lookup, in order: a module-scope declaration
 * of that symbol; a declaration exported under that name
 * (`export { TileImpl as Tile }`); any declaration of that symbol in any scope.
 * `ComponentId.export` carries only the bare name (no scope), so a component
 * declared inside a nested scope (e.g. a shadowed IIFE-local
 * `const Comp = () => <span/>;`) is only findable by symbol; module-scope-only
 * lookup would reject it even though the engine's own resolution already
 * landed on it.
 *
 * Known imprecision (this is a lookup, not a resolution walk): when two
 * sibling scopes both declare a same-named symbol with different shapes (two
 * `Item`s in unrelated function bodies, one a component, one not) and nothing
 * is exported under that name, the last step takes the first match in
 * `fg.declarations`' Map order (insertion order, i.e. source order),
 * regardless of which scope the caller actually meant.
 * `ComponentId.export` has no scope field to disambiguate with; threading
 * scope through `ComponentId` is the real fix.
 */
export function findDeclaration(fg: FileGraph, name: string): BindingDecl | undefined {
  const atModuleScope = fg.declarations.get(`${MODULE_SCOPE}::${name}`);
  if (atModuleScope) return atModuleScope;
  for (const decl of fg.declarations.values()) {
    if (decl.exportedAs === name) return decl;
  }
  for (const decl of fg.declarations.values()) {
    if (decl.symbol === name) return decl;
  }
  return undefined;
}
