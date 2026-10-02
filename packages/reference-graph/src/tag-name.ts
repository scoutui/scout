/**
 * The HTML Standard's "valid custom element name", §4.13.3 Core concepts
 * (https://html.spec.whatwg.org/multipage/custom-elements.html#valid-custom-element-name):
 * a valid element local name (DOM Standard,
 * https://dom.spec.whatwg.org/#valid-element-local-name) whose first code
 * point is an ASCII lower alpha, that contains no ASCII upper alpha, that
 * contains U+002D (-), and that is not one of the reserved names below.
 *
 * With an ASCII-alpha first code point, a valid element local name is one
 * that contains no ASCII whitespace, U+0000 NULL, U+002F (/) or U+003E (>).
 */

/** The hyphenated names SVG and MathML already use, which no custom element may take. */
export const RESERVED_CUSTOM_ELEMENT_NAMES: ReadonlySet<string> = new Set([
  "annotation-xml",
  "color-profile",
  "font-face",
  "font-face-src",
  "font-face-uri",
  "font-face-format",
  "font-face-name",
  "missing-glyph",
]);

/** A lower-alpha first code point, then none of ASCII whitespace, NULL, `/`, `>` or an ASCII upper alpha. */
const LOWER_ALPHA_LOCAL_NAME = /^[a-z][^\0\t\n\f\r />A-Z]*$/;

/** The written tag name, ASCII-lowercased: the name an HTML document gives the element. */
export function canonicalTagName(written: string): string {
  return written.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** True when `name` is a valid custom element name. */
export function isValidCustomElementName(name: string): boolean {
  return LOWER_ALPHA_LOCAL_NAME.test(name) && name.includes("-") && !RESERVED_CUSTOM_ELEMENT_NAMES.has(name);
}

declare const __brand: unique symbol;
type Brand<K, T> = K & { readonly [__brand]: T };

export type TagName = Brand<string, "TagName">;

/** Unsafe constructor: use only at the data-ingest boundary. */
export const asTagName = (s: string): TagName => s as TagName;
