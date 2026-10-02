const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const MEMBER_PATH_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/;

/**
 * Classify an already-extracted Vue template expression *string* as a bare
 * `reference` (identifier or dotted member path)
 * or `dynamic`. AST-based parsers (React) classify structurally instead.
 * Vue template bindings all use this one seam.
 */
export function classifyExprText(
  text: string,
): { tier: "reference"; ref: string } | { tier: "dynamic" } {
  const t = text.trim();
  if (IDENT_RE.test(t) || MEMBER_PATH_RE.test(t)) return { tier: "reference", ref: t };
  return { tier: "dynamic" };
}
