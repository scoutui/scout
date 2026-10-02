/**
 * A scope id is opaque per-FileGraph. Sequential ints assigned by
 * GraphBuilder.pushScope(); module scope is always 0.
 */
export type ScopeId = number;

export const MODULE_SCOPE: ScopeId = 0;

/**
 * A Reference is what a parser emits when it sees an identifier in code.
 * Captures the identifier as written, the scope it resolves in, and any
 * member access chain (`<Foo.Bar.Baz />` produces memberChain ["Bar", "Baz"]).
 *
 * `originFile` records the repo-relative file path the ref was authored in.
 * `scope` is opaque per-FileGraph, so once a TypeOf travels across module
 * boundaries (e.g. through a cross-module function return) the only way to
 * look the ref up correctly is to switch to its origin FileGraph. Parsers
 * stamp this; engine resolution reads it. A ref without it (a synthetic ref,
 * or one from a parser that does not stamp it) is looked up in whichever
 * FileGraph the caller passes.
 */
export type Reference = {
  symbol: string;
  scope: ScopeId;
  memberChain: string[];
  loc: { line: number; column: number };
  originFile?: string;
};
