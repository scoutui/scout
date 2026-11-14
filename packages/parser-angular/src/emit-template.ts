import type { FileBuilder, OccurrenceVia, PropUsage, Reference } from "@scoutui/reference-graph";
import { canonicalTagName, isValidCustomElementName, MODULE_SCOPE } from "@scoutui/reference-graph";
import type { AngularCompiler } from "./compiler.js";
import type { ElementMatch, SelectorEntry, SelectorIndex } from "./selector-index.js";

/** Elements Angular's compiler handles itself: never a component use and never a miss. */
const ANGULAR_BUILTIN_ELEMENTS = new Set(["ng-container", "ng-template", "ng-content"]);

/**
 * Node properties holding child nodes, across elements, `<ng-template>` and the
 * control-flow blocks. `@switch` keeps its cases in `cases` up to Angular 20 and
 * in `groups` (each holding `cases`) from Angular 21.
 */
const CHILD_KEYS = ["children", "branches", "cases", "groups", "empty", "placeholder", "loading", "error"] as const;

const IDENT_PATH_RE = /^[A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*)*$/;
const QUOTED_RE = /^(['"])(.*)\1$/s;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

/** How a matched component is reached from the file that declares the template's component. */
export type ResolvedLocal = { local: string; via?: OccurrenceVia };

export type EmitAngularTemplateOpts = {
  compiler: AngularCompiler;
  /** The template source, inline or read from its `templateUrl`. */
  template: string;
  /** Passed to the compiler for its messages. */
  templateUrl: string;
  /** Where the template's first character sits in the file the uses are recorded in (1-based). */
  origin: { line: number; column: number };
  /** The builder of the file the uses are recorded in: the component's `.ts` file, or its `.html` template. */
  fileBuilder: FileBuilder;
  /** The component class that owns every use in the template. */
  owner: Reference;
  index: SelectorIndex;
  /** Narrows an element's matches to the components in scope for this template, such as a standalone component's `imports`. */
  inScope: (entry: SelectorEntry) => boolean;
  /**
   * The scope couldn't be read in full, so `inScope` only knows part of it. An
   * element no in-scope component matches is then matched against every
   * component instead, since the unread part may supply it; an element an
   * in-scope component does match stays within the scope, so a same-named
   * component elsewhere in the repo doesn't make it ambiguous.
   */
  scopeIsPartial?: boolean;
  /** The binding name the owner's file reaches a matched component by, adding an import there when it has none. */
  resolveLocal: (entry: SelectorEntry, loc: { line: number; column: number }) => ResolvedLocal;
  onTemplateError: (message: string) => void;
  onAmbiguous: (tag: string, loc: { line: number; column: number }, matches: readonly ElementMatch[]) => void;
  /**
   * An element whose selector matches one or more components, none of them in
   * the template's scope. Angular would reject this the same as an unknown
   * element, but in a repo that builds, it usually means the scan's scope
   * reading (a standalone component's `imports`, or an NgModule's
   * declarations/imports) missed something. Optional: a caller that doesn't
   * pass it keeps the element silent, as before.
   */
  onOutOfScope?: (tag: string, loc: { line: number; column: number }, matches: readonly ElementMatch[]) => void;
  /**
   * Picks the entry point for a library component several entry points of its
   * package re-export. Defaults to the first by specifier.
   */
  chooseEntry?: (matches: readonly ElementMatch[]) => ElementMatch;
};

/** The package a bare specifier names: `@scope/name` or `name`. */
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/**
 * Collapses matches that are one library class reached more than once: by
 * several entry points of its package, or under several export names (such
 * as `NgIcon` and `NgIcon as NgIconComponent`). Same package, same declared
 * class and same selector; an entry without a known class falls back to its
 * export name. Two different components that share a selector stay separate.
 */
function collapseReexports(matches: readonly ElementMatch[], choose: (group: readonly ElementMatch[]) => ElementMatch): ElementMatch[] {
  const groups = new Map<string, ElementMatch[]>();
  const order: string[] = [];
  for (const m of matches) {
    const key =
      m.entry.source.type === "package"
        ? `${packageNameOf(m.entry.source.specifier)}#${m.entry.declaredAs ? `${m.entry.declaredAs.file}#${m.entry.declaredAs.className}` : m.entry.exportName}#${m.selector}`
        : `file:${m.entry.source.graphKey}#${m.entry.exportName}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [m]);
      order.push(key);
    } else {
      group.push(m);
    }
  }
  return order.map((key) => {
    const group = groups.get(key) as ElementMatch[];
    return group.length === 1 ? (group[0] as ElementMatch) : choose(group);
  });
}

/** The default entry for a collapsed class: first by specifier, then the name the class is declared under, then export name. */
const firstBySpecifier = (group: readonly ElementMatch[]): ElementMatch =>
  [...group].sort(
    (a, b) =>
      specifierOf(a).localeCompare(specifierOf(b)) ||
      Number(b.entry.exportName === b.entry.declaredAs?.className) - Number(a.entry.exportName === a.entry.declaredAs?.className) ||
      a.entry.exportName.localeCompare(b.entry.exportName),
  )[0] as ElementMatch;
const specifierOf = (m: ElementMatch) => (m.entry.source.type === "package" ? m.entry.source.specifier : m.entry.source.graphKey);

type TmplNode = { [key: string]: unknown };
type TmplElement = TmplNode & {
  name: string;
  attributes: { name: string; value: string }[];
  inputs: { name: string; value?: { source?: string | null } | null }[];
  outputs: { name: string }[];
  sourceSpan: { start: { line: number; col: number } };
};

function isElement(node: TmplNode): node is TmplElement {
  const el = node as Partial<TmplElement>;
  return (
    typeof el.name === "string" &&
    Array.isArray(el.attributes) &&
    Array.isArray(el.inputs) &&
    Array.isArray(el.outputs) &&
    typeof el.sourceSpan === "object" &&
    el.sourceSpan !== null
  );
}

/**
 * Parses one Angular template with the repo's own compiler and records each
 * element that renders a component as a use owned by the template's component.
 * Elements are matched by selector, as Angular matches them; a hyphenated
 * element no component in scope matches is recorded as a custom element.
 */
export function emitAngularTemplate(opts: EmitAngularTemplateOpts): void {
  const parsed = opts.compiler.parseTemplate(opts.template, opts.templateUrl, { preserveWhitespaces: false });
  for (const error of parsed.errors ?? []) opts.onTemplateError(error.msg ?? String(error));

  const position = (start: { line: number; col: number }) =>
    start.line === 0
      ? { line: opts.origin.line, column: opts.origin.column + start.col }
      : { line: opts.origin.line + start.line, column: start.col + 1 };

  const visit = (node: TmplNode): void => {
    if (isElement(node)) emitElement(node);
    for (const key of CHILD_KEYS) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) if (child !== null && typeof child === "object") visit(child as TmplNode);
      } else if (value !== null && typeof value === "object") {
        visit(value as TmplNode);
      }
    }
  };

  const emitElement = (el: TmplElement): void => {
    const tag = el.name;
    // Namespaced elements (`:svg:path`) are never components.
    if (ANGULAR_BUILTIN_ELEMENTS.has(tag) || tag.startsWith(":")) return;
    const loc = position(el.sourceSpan.start);
    const classNames = el.attributes.find((a) => a.name === "class")?.value.split(/\s+/).filter(Boolean) ?? [];
    const attributeNames = [...el.attributes.map((a) => a.name), ...el.inputs.map((i) => i.name)];
    const attributeValues = new Map(el.attributes.map((a) => [a.name, a.value]));
    const found = opts.index.match({ name: tag, attributes: attributeNames, attributeValues, classNames });
    const inScope = found.filter((m) => opts.inScope(m.entry));
    const matches = collapseReexports(inScope.length === 0 && opts.scopeIsPartial === true ? found : inScope, opts.chooseEntry ?? firstBySpecifier);

    const shape = { name: tag, attributes: attributeNames, attributeValues, classNames };
    const addUse = (match: ElementMatch) => {
      const { props, events } = readBindings(el, match);
      const { local, via } = opts.resolveLocal(match.entry, loc);
      const ref = opts.owner.originFile === undefined ? refTo(local, loc) : { ...refTo(local, loc), originFile: opts.owner.originFile };
      opts.fileBuilder.addJsxUsage({ ref, loc, props, events });
      opts.fileBuilder.setOwner(opts.owner, via);
    };

    // At most one component renders the element.
    const match = matches[0];
    if (matches.length > 1) {
      opts.onAmbiguous(tag, loc, matches);
    } else if (match !== undefined) {
      addUse(match);
    } else if (found.length > 0) {
      // Every selector match for this tag exists, but none is in scope. Angular
      // would reject this the same as an unknown element, but in a repo that
      // builds, it's a sign the scan's own scope reading missed something.
      opts.onOutOfScope?.(tag, loc, found);
    } else if (!opts.index.matchesDirective(shape) && isValidCustomElementName(canonicalTagName(tag))) {
      // An element a directive claims is Angular's own, not a custom element.
      const { props, events } = readBindings(el, undefined);
      opts.fileBuilder.addTagUsage({ tagName: tag, loc, props, events });
      opts.fileBuilder.setTagOwner(opts.owner);
    }
    // Plain HTML falls through: never tracked, never diagnosed.

    // Any number of directives apply to one element, each its own use, when it's written there rather than riding along.
    const bound = new Set(attributeNames);
    for (const directive of owned(directivesOn(shape, tag, loc), matches.length === 1 ? match : undefined, bound)) addUse(directive);
  };

  /**
   * The directives an element writes that apply to it: every one in scope, as Angular applies them all. When none is
   * and the scope is only partly known, every directive the element writes instead, except where two different
   * classes answer to the same written selector: the scan can't tell which the unread part brings in, so neither counts.
   */
  const directivesOn = (shape: Parameters<SelectorIndex["matchDirectives"]>[0], tag: string, loc: { line: number; column: number }): ElementMatch[] => {
    const choose = opts.chooseEntry ?? firstBySpecifier;
    const found = opts.index.matchDirectives(shape);
    const inScope = found.filter((m) => opts.inScope(m.entry));
    if (inScope.length > 0 || opts.scopeIsPartial !== true) return collapseReexports(inScope, choose);
    const byPart = new Map<string, ElementMatch[]>();
    for (const m of found) {
      const part = m.matchedPart ?? m.selector;
      byPart.set(part, [...(byPart.get(part) ?? []), m]);
    }
    const out: ElementMatch[] = [];
    for (const group of byPart.values()) {
      const classes = collapseReexports(group, choose);
      if (classes.length > 1) opts.onAmbiguous(tag, loc, classes);
      else for (const m of classes) if (!out.some((o) => o.entry === m.entry)) out.push(m);
    }
    return out;
  };

  for (const node of parsed.nodes) if (node !== null && typeof node === "object") visit(node as TmplNode);
}

/**
 * The directives an element counts as uses of, out of every one it matches. Each name the element writes (see
 * `ElementMatch.names`) belongs to the classes that take it as an input; failing that, to the component that matched
 * through it; failing that, to every directive that did. A directive counts when it owns one of its names, or when the
 * element binds one of its other inputs. So `NgModel` owns `ngModel` and counts, while `NgControlStatus`, which only
 * rides along on `ngModel`, doesn't. A directive whose inputs aren't known counts.
 */
function owned(directives: readonly ElementMatch[], component: ElementMatch | undefined, bound: ReadonlySet<string>): ElementMatch[] {
  const takesInput = (m: ElementMatch, name: string) => m.entry.inputs?.includes(name) === true;
  const ownerOf = (name: string): readonly ElementMatch[] => {
    const all = component === undefined ? directives : [component, ...directives];
    const takers = all.filter((m) => takesInput(m, name));
    if (takers.length > 0) return takers;
    if (component?.names?.has(name) === true) return [component];
    return directives.filter((m) => m.names?.has(name) === true);
  };
  return directives.filter((d) => {
    if (d.entry.inputs === undefined) return true;
    const names = d.names ?? new Set<string>();
    if ([...names].some((name) => ownerOf(name).includes(d))) return true;
    return d.entry.inputs.some((input) => !names.has(input) && bound.has(input));
  });
}

function refTo(symbol: string, loc: { line: number; column: number }): Reference {
  return { symbol, scope: MODULE_SCOPE, memberChain: [], loc };
}

/**
 * The props and events an element binds on its component or directive. When
 * its API is known, only its declared inputs and outputs count, so `class` and
 * `id` aren't reported as props. The attribute its own selector requires is
 * left out too, unless that attribute is also an input and carries a value
 * (`[exTooltip]="text"`, `exTooltip="Save"`): then it's the input's value.
 * When the API isn't known, every binding but the selector's own attributes
 * counts.
 */
export function readBindings(el: TmplElement, match: ElementMatch | undefined): { props: PropUsage[]; events: string[] } {
  const inputs = match?.entry.inputs;
  const outputs = match?.entry.outputs;
  const selectorAttributes = match?.selectorAttributes ?? new Set<string>();
  const isInput = (name: string, hasValue: boolean) =>
    inputs === undefined ? !selectorAttributes.has(name) : inputs.includes(name) && (hasValue || !selectorAttributes.has(name));
  const props: PropUsage[] = [];
  for (const attr of el.attributes) {
    if (!isInput(attr.name, attr.value !== "")) continue;
    props.push({ name: attr.name, tier: "written", value: attr.value === "" ? true : attr.value });
  }
  for (const input of el.inputs) {
    if (!isInput(input.name, true)) continue;
    props.push(classifyBound(input.name, input.value?.source ?? ""));
  }
  const events = el.outputs.map((o) => o.name).filter((name) => outputs === undefined || outputs.includes(name));
  return { props, events };
}

/** A bound value: a literal is a written value, a property path a reference, anything else dynamic. */
function classifyBound(name: string, source: string): PropUsage {
  const expr = source.trim();
  const quoted = expr.match(QUOTED_RE);
  if (quoted) return { name, tier: "written", value: quoted[2] ?? "" };
  if (NUMBER_RE.test(expr)) return { name, tier: "written", value: Number(expr) };
  if (expr === "true" || expr === "false") return { name, tier: "written", value: expr === "true" };
  if (expr === "null") return { name, tier: "written", value: null };
  if (IDENT_PATH_RE.test(expr)) return { name, tier: "reference", ref: expr };
  return { name, tier: "dynamic" };
}
