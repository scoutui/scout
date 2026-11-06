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
  /** The binding name the owner's file reaches a matched component by, adding an import there when it has none. */
  resolveLocal: (entry: SelectorEntry, loc: { line: number; column: number }) => ResolvedLocal;
  onTemplateError: (message: string) => void;
  onAmbiguous: (tag: string, loc: { line: number; column: number }, matches: readonly ElementMatch[]) => void;
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
 * Collapses matches that are one library class re-exported by several entry
 * points of its package: same package, same export name, same selector. Two
 * different components that share a selector stay separate.
 */
function collapseReexports(matches: readonly ElementMatch[], choose: (group: readonly ElementMatch[]) => ElementMatch): ElementMatch[] {
  const groups = new Map<string, ElementMatch[]>();
  const order: string[] = [];
  for (const m of matches) {
    const key =
      m.entry.source.type === "package"
        ? `${packageNameOf(m.entry.source.specifier)}#${m.entry.exportName}#${m.selector}`
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

const firstBySpecifier = (group: readonly ElementMatch[]): ElementMatch =>
  [...group].sort((a, b) => specifierOf(a).localeCompare(specifierOf(b)))[0] as ElementMatch;
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
    const found = opts.index.match({ name: tag, attributes: attributeNames, classNames });
    const matches = collapseReexports(
      found.filter((m) => opts.inScope(m.entry)),
      opts.chooseEntry ?? firstBySpecifier,
    );

    if (matches.length > 1) {
      opts.onAmbiguous(tag, loc, matches);
      return;
    }
    const match = matches[0];
    if (match !== undefined) {
      const { props, events } = readBindings(el, match);
      const { local, via } = opts.resolveLocal(match.entry, loc);
      const ref = opts.owner.originFile === undefined ? refTo(local, loc) : { ...refTo(local, loc), originFile: opts.owner.originFile };
      opts.fileBuilder.addJsxUsage({ ref, loc, props, events });
      opts.fileBuilder.setOwner(opts.owner, via);
      return;
    }
    // A component the template can't see isn't a custom element either: Angular
    // rejects it, so it is no use at all.
    const shape = { name: tag, attributes: attributeNames, classNames };
    if (found.length === 0 && !opts.index.matchesDirective(shape) && isValidCustomElementName(canonicalTagName(tag))) {
      const { props, events } = readBindings(el, undefined);
      opts.fileBuilder.addTagUsage({ tagName: tag, loc, props, events });
      opts.fileBuilder.setTagOwner(opts.owner);
    }
    // Plain HTML falls through: never tracked, never diagnosed.
  };

  for (const node of parsed.nodes) if (node !== null && typeof node === "object") visit(node as TmplNode);
}

function refTo(symbol: string, loc: { line: number; column: number }): Reference {
  return { symbol, scope: MODULE_SCOPE, memberChain: [], loc };
}

/**
 * The props and events an element binds on its component. When the component's
 * API is known, only its declared inputs and outputs count, so `class`, `id`
 * and the attribute its own selector requires aren't reported as props. When it
 * isn't known, every binding but the selector's own attributes counts.
 */
export function readBindings(el: TmplElement, match: ElementMatch | undefined): { props: PropUsage[]; events: string[] } {
  const inputs = match?.entry.inputs;
  const outputs = match?.entry.outputs;
  const skip = match?.selectorAttributes ?? new Set<string>();
  const isInput = (name: string) => !skip.has(name) && (inputs === undefined || inputs.includes(name));
  const props: PropUsage[] = [];
  for (const attr of el.attributes) {
    if (!isInput(attr.name)) continue;
    props.push({ name: attr.name, tier: "written", value: attr.value === "" ? true : attr.value });
  }
  for (const input of el.inputs) {
    if (!isInput(input.name)) continue;
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
