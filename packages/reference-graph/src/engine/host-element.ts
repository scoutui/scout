import type { FileGraph } from "../index.js";
import { isDefaultExport } from "./binding.js";

/**
 * React's own hook predicate (`isHookName` in rules-of-hooks and the
 * compiler).
 */
export const HOOK_NAME = /^use[A-Z0-9]/;

/**
 * The JSX host-element naming rule. JSX compiles a bare element name to a
 * string when it is lowercase-initial or contains `-` (no JS identifier
 * does), as in `div`, `svg`, `web-button`, `X-Card`, so such a name can never
 * denote a component binding. `_Foo` and `$x` are component references: the
 * rule is `/^[a-z]/` or a `-`, not "is not PascalCase".
 * Among these names, a valid custom element name (`web-button`, `X-Card`
 * once canonical) renders a custom element, which the engine reports as a
 * tag occurrence (`evaluateJsxUsage`, `engine/index.ts`).
 *
 * Takes a bare name. A member expression (`<foo.Bar/>`) is never an
 * intrinsic, so a caller holding a reference checks `memberChain.length === 0`
 * first (`isHostElementRoot`, `engine/index.ts`).
 *
 * `isPascalCase` in `parser-react/src/find-owner.ts` is a different predicate
 * (`/^[A-Z]/`, which rejects `_Foo`). Do not fold it into this one.
 */
export function isHostElementName(name: string): boolean {
  return /^[a-z]/.test(name) || name.includes("-");
}

/**
 * The "this declaration can never be rendered as a component" test:
 * every name it could be rendered under is a host-element name. Roster
 * membership calls it (`excludeHostElementNames`, `registry.ts`); owner
 * classification (`classifyDeclaration`, `helper-callers.ts`) consults that
 * narrowed roster rather than this rule.
 *
 * Two exemptions, both about which name a renderer actually sees:
 *
 * - A **default export**: the importer picks the name, so the local one
 *   carries no information (`export default () => <div/>` declares the
 *   symbol `default`; `const view = …; export default view` declares `view`).
 * - A **component-named export alias**: `export { helper as Button }` is
 *   rendered as `<Button/>` by every importer.
 *
 * The alias is read from the file's export records, not from
 * `BindingDecl.exportedAs`: that field is declared on the type but no parser
 * writes it.
 */
export function hasOnlyHostElementNames(symbol: string, fileGraph: FileGraph | undefined): boolean {
  if (!isHostElementName(symbol)) return false;
  if (fileGraph === undefined) return symbol !== "default";
  if (isDefaultExport(fileGraph, symbol)) return false;
  return !fileGraph.exports.some((exp) => exp.kind === "named" && "local" in exp && exp.local === symbol && !isHostElementName(exp.exportedAs));
}
