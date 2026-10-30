import type { AngularCompiler, CssSelector, SelectorMatcher } from "./compiler.js";

/** A component a selector names: where its class is declared, and the API it declares when that's known. */
export type SelectorEntry = {
  /** The graph key of the file that declares the class, or the package a library component comes from. */
  source: { type: "file"; graphKey: string } | { type: "package"; specifier: string };
  exportName: string;
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
};

type ElementShape = { name: string; attributes: readonly string[]; classNames: readonly string[] };

export type SelectorIndex = {
  /** Every distinct component whose selector matches the element. */
  match(element: ElementShape): ElementMatch[];
  /** Whether a directive's selector matches the element: Angular owns it, so it is no custom element. */
  matchesDirective(element: ElementShape): boolean;
};

/** Indexes components by their selectors, using Angular's own matcher so every selector form Angular accepts matches as it does in Angular. */
export function createSelectorIndex(
  compiler: AngularCompiler,
  components: readonly { selector: string; entry: SelectorEntry }[],
  directiveSelectors: readonly string[] = [],
): SelectorIndex {
  const matcher: SelectorMatcher<SelectorEntry> = new compiler.SelectorMatcher<SelectorEntry>();
  const selectorOf = new Map<SelectorEntry, string>();
  for (const { selector, entry } of components) {
    matcher.addSelectables(compiler.CssSelector.parse(selector), entry);
    selectorOf.set(entry, selector);
  }
  const directives: SelectorMatcher<true> = new compiler.SelectorMatcher<true>();
  for (const selector of directiveSelectors) directives.addSelectables(compiler.CssSelector.parse(selector), true);
  const toCss = (element: ElementShape) => {
    const css = new compiler.CssSelector();
    css.setElement(element.name);
    for (const name of element.attributes) css.addAttribute(name, "");
    for (const name of element.classNames) css.addClassName(name);
    return css;
  };
  return {
    matchesDirective: (element) => directives.match(toCss(element), null),
    match(element) {
      const css = toCss(element);
      const matches: ElementMatch[] = [];
      matcher.match(css, (selector: CssSelector, entry) => {
        if (matches.some((m) => m.entry === entry)) return;
        // `attrs` holds name/value pairs.
        const names = new Set<string>();
        for (let i = 0; i < selector.attrs.length; i += 2) {
          const name = selector.attrs[i];
          if (name !== undefined) names.add(name);
        }
        matches.push({ entry, selector: selectorOf.get(entry) ?? "", selectorAttributes: names });
      });
      return matches;
    },
  };
}
