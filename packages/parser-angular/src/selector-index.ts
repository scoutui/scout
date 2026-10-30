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
  /** Attribute names the matching selector itself requires, such as `app-icon-button` in `button[app-icon-button]`. */
  selectorAttributes: ReadonlySet<string>;
};

export type SelectorIndex = {
  /** Every distinct component whose selector matches the element. */
  match(element: { name: string; attributes: readonly string[]; classNames: readonly string[] }): ElementMatch[];
};

/** Indexes components by their selectors, using Angular's own matcher so every selector form Angular accepts matches as it does in Angular. */
export function createSelectorIndex(
  compiler: AngularCompiler,
  components: readonly { selector: string; entry: SelectorEntry }[],
): SelectorIndex {
  const matcher: SelectorMatcher<SelectorEntry> = new compiler.SelectorMatcher<SelectorEntry>();
  for (const { selector, entry } of components) {
    matcher.addSelectables(compiler.CssSelector.parse(selector), entry);
  }
  return {
    match(element) {
      const css = new compiler.CssSelector();
      css.setElement(element.name);
      for (const name of element.attributes) css.addAttribute(name, "");
      for (const name of element.classNames) css.addClassName(name);
      const matches: ElementMatch[] = [];
      matcher.match(css, (selector: CssSelector, entry) => {
        if (matches.some((m) => m.entry === entry)) return;
        // `attrs` holds name/value pairs.
        const names = new Set<string>();
        for (let i = 0; i < selector.attrs.length; i += 2) {
          const name = selector.attrs[i];
          if (name !== undefined) names.add(name);
        }
        matches.push({ entry, selectorAttributes: names });
      });
      return matches;
    },
  };
}
