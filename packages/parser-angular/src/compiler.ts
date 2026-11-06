/**
 * The parts of `@angular/compiler` this package reads. The CLI loads the copy
 * installed in the scanned repo, so these are structural types rather than an
 * import of the package: its API is the same in every supported version.
 */
export type AngularCompiler = {
  parseTemplate(
    template: string,
    templateUrl: string,
    options?: { preserveWhitespaces?: boolean },
  ): { nodes: unknown[]; errors?: readonly { msg?: string }[] | null };
  CssSelector: {
    new (): CssSelector;
    parse(selector: string): CssSelector[];
  };
  SelectorMatcher: new <T>() => SelectorMatcher<T>;
};

export type CssSelector = {
  element: string | null;
  attrs: string[];
  classNames: string[];
  setElement(name: string): void;
  addAttribute(name: string, value: string): void;
  addClassName(name: string): void;
};

export type SelectorMatcher<T> = {
  addSelectables(selectors: CssSelector[], context: T): void;
  match(selector: CssSelector, callback: ((selector: CssSelector, context: T) => void) | null): boolean;
};
