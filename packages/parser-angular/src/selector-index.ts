import type { AngularCompiler, CssSelector, SelectorMatcher } from "./compiler.js";

/** A component a selector names: where its class is declared, and the API it declares when that's known. */
export type SelectorEntry = {
  /** The graph key of the file that declares the class, or the package a library component comes from. */
  source: { type: "file"; graphKey: string } | { type: "package"; specifier: string };
  exportName: string;
  /** The class behind a library entry, when known: entries with the same `declaredAs` are one component exported under several names. */
  declaredAs?: { file: string; className: string };
  /** Input names as written in templates (aliases applied). Absent when the component's API isn't known. */
  inputs?: readonly string[];
  /** Output names as written in templates (aliases applied). Absent when the component's API isn't known. */
  outputs?: readonly string[];
};

/** What one element matched. */
export type ElementMatch = {
  entry: SelectorEntry;
  /** The selector the component declares, as written. */
  selector: string;
  /** Attribute names the matching selector itself requires, such as `app-icon-button` in `button[app-icon-button]`. */
  selectorAttributes: ReadonlySet<string>;
  /** The part of the selector that matched, as Angular prints it (`[exTooltip]` of `ex-tip, [exTooltip]`): what an element writes to get this match. */
  matchedPart?: string;
  /**
   * The names the matched part has the element write: its element when hyphenated (`ex-card`), and each attribute it
   * requires without a value (`exTooltip`, not `type` in `input[type=checkbox]`). Across every matching part of a
   * directive's selector.
   */
  names?: ReadonlySet<string>;
};

/**
 * A directive the index knows: a bare selector only claims its element (an element it names is Angular's own, never
 * a custom element), and a selector with an entry is also counted wherever it's written, like a component.
 */
export type DirectiveSelector = string | { selector: string; entry: SelectorEntry };

type ElementShape = { name: string; attributes: readonly string[]; classNames: readonly string[] };

export type SelectorIndex = {
  /** Every distinct component whose selector matches the element. */
  match(element: ElementShape): ElementMatch[];
  /** Whether a directive's selector, one with an element part, matches the element: Angular owns it, so it is no custom element. Attribute- or class-only directive selectors never claim the tag. */
  matchesDirective(element: ElementShape): boolean;
  /**
   * Every distinct counted directive whose selector the element writes. A match that rests only on a plain HTML tag
   * (`form` in `NgForm`'s `form:not([ngNoForm])`) is left out: nothing about the element names the directive.
   */
  matchDirectives(element: ElementShape): ElementMatch[];
};

/** A matched selector part that names only a plain HTML element, with no attribute or class written to pick it. */
function restsOnPlainTag(selector: CssSelector): boolean {
  const element = selector.element;
  return element !== null && element !== "*" && !element.includes("-") && selector.attrs.length === 0 && selector.classNames.length === 0;
}

/** The names a matched selector part has the element write: see `ElementMatch.names`. */
function writtenNames(selector: CssSelector): Set<string> {
  const names = new Set<string>();
  const element = selector.element;
  if (element?.includes("-")) names.add(element);
  // `attrs` holds name/value pairs.
  for (let i = 0; i < selector.attrs.length; i += 2) {
    const name = selector.attrs[i];
    if (name !== undefined && name !== "" && selector.attrs[i + 1] === "") names.add(name);
  }
  return names;
}

/** Indexes components by their selectors, using Angular's own matcher so every selector form Angular accepts matches as it does in Angular. */
export function createSelectorIndex(
  compiler: AngularCompiler,
  components: readonly { selector: string; entry: SelectorEntry }[],
  directiveSelectors: readonly DirectiveSelector[] = [],
): SelectorIndex {
  const matcher: SelectorMatcher<SelectorEntry> = new compiler.SelectorMatcher<SelectorEntry>();
  const selectorOf = new Map<SelectorEntry, string>();
  for (const { selector, entry } of components) {
    matcher.addSelectables(compiler.CssSelector.parse(selector), entry);
    selectorOf.set(entry, selector);
  }
  const directives: SelectorMatcher<true> = new compiler.SelectorMatcher<true>();
  // Only a selector that names an element (`ex-hint`, `ex-card[kind]`) claims that tag.
  // A directive reached purely through attributes or classes (`[routerLink]`, `.foo`) leaves the tag its own.
  const counted: SelectorMatcher<SelectorEntry> = new compiler.SelectorMatcher<SelectorEntry>();
  for (const d of directiveSelectors) {
    const selector = typeof d === "string" ? d : d.selector;
    const parsedList = compiler.CssSelector.parse(selector);
    for (const parsed of parsedList) {
      if (parsed.element !== null && parsed.element !== "*") directives.addSelectables([parsed], true);
    }
    if (typeof d !== "string") {
      // Each part on its own: Angular reports only the first part of a list that matches, which may be one this
      // leaves out (`form` in `form:not([ngNoForm]),[ngForm]` on `<form ngForm>`).
      for (const parsed of parsedList) if (!restsOnPlainTag(parsed)) counted.addSelectables([parsed], d.entry);
      selectorOf.set(d.entry, selector);
    }
  }
  const toCss = (element: ElementShape) => {
    const css = new compiler.CssSelector();
    css.setElement(element.name);
    for (const name of element.attributes) css.addAttribute(name, "");
    for (const name of element.classNames) css.addClassName(name);
    return css;
  };
  const toMatch = (selector: CssSelector, entry: SelectorEntry): ElementMatch => {
    // `attrs` holds name/value pairs.
    const names = new Set<string>();
    for (let i = 0; i < selector.attrs.length; i += 2) {
      const name = selector.attrs[i];
      if (name !== undefined) names.add(name);
    }
    return { entry, selector: selectorOf.get(entry) ?? "", selectorAttributes: names, matchedPart: selector.toString(), names: writtenNames(selector) };
  };
  return {
    matchesDirective: (element) => directives.match(toCss(element), null),
    match(element) {
      const matches: ElementMatch[] = [];
      matcher.match(toCss(element), (selector: CssSelector, entry) => {
        if (!matches.some((m) => m.entry === entry)) matches.push(toMatch(selector, entry));
      });
      return matches;
    },
    matchDirectives(element) {
      const matches: ElementMatch[] = [];
      counted.match(toCss(element), (selector: CssSelector, entry) => {
        const seen = matches.find((m) => m.entry === entry);
        if (seen === undefined) matches.push(toMatch(selector, entry));
        else seen.names = new Set([...(seen.names ?? []), ...writtenNames(selector)]);
      });
      return matches;
    },
  };
}
