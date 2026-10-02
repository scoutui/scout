import type { OccurrenceVia } from "../types/occurrence-via.js";
import type { TerminalIdentity } from "./wrapper-folding.js";

/**
 * The closed set of things a value can denote when something asks "what is
 * this tag". One variant per outcome a caller can act on differently. Adding a
 * variant is a compile error at every `matchDenotation` call and in
 * `RENDER_VERDICT`.
 */
export type Denotation =
  /** An element value: a render body, or an already-rendered `const br = <br/>`. */
  | { kind: "element" }
  /** A string the walk reached through value hops only (a reference, a union
   *  branch, a member of an object or array literal), so the tag itself is the
   *  string: an intrinsic host element. */
  | { kind: "host-string"; value: string | null }
  /** A framework value that is provably not a component (a context object). */
  | { kind: "opaque"; semantics: OpaqueSemantics }
  /** A value supplied somewhere else: an unsubstituted parameter, a prop read
   *  off one, a hook result. */
  | { kind: "late-bound"; source: LateBoundSource }
  /** An import the graph cannot see. Identity known, shape unknowable. */
  | { kind: "foreign" }
  /** Data: a value that reached tag position without being one (an object or
   *  array literal, or a string a function body or a call returned). */
  | { kind: "data"; shape: "object" | "array" | "string" }
  /** Nothing known. */
  | { kind: "indeterminate" }
  /** A function reached at a tag position: what JSX renders is the function
   *  itself, whatever it returns. */
  | { kind: "callable" };

export type OpaqueSemantics = "context";
export type LateBoundSource = "parameter" | "parameter-member" | "hook-result";

/**
 * One branch of an evaluation. `identity` is the binding this branch credits
 * (null = "the caller's own fallback names this render"); `viaTrail` is the
 * fold's hops, outermost-first, excluding the caller's outer via.
 */
export type Terminal = {
  denotation: Denotation;
  identity: TerminalIdentity;
  viaTrail: OccurrenceVia[];
};

/** The result of evaluating one value. Never empty. */
export type Evaluation = readonly [Terminal, ...Terminal[]];

/** One handler per denotation kind. A missing key is a type error; there is
 *  deliberately no default case and no `Partial`. */
export type DenotationCases<R> = {
  [K in Denotation["kind"]]: (d: Extract<Denotation, { kind: K }>, t: Terminal) => R;
};

/** The only sanctioned reader of `Denotation["kind"]` outside this module. */
export function matchDenotation<R>(t: Terminal, cases: DenotationCases<R>): R {
  const handler = cases[t.denotation.kind] as (d: Denotation, t: Terminal) => R;
  return handler(t.denotation, t);
}

type RenderVerdict = "credit" | "silent" | "late-bound" | "unresolved";

/** What one denotation means for a tag position. */
const RENDER_VERDICT: DenotationCases<RenderVerdict> = {
  element: () => "credit",
  foreign: () => "credit",
  "host-string": () => "silent",
  opaque: () => "silent",
  "late-bound": () => "late-bound",
  data: () => "unresolved",
  indeterminate: () => "unresolved",
  callable: () => "credit",
};

/** The fan-out precedence: a Union / dynamic-map evaluation has several
 *  terminals with different verdicts, and the highest wins. */
const VERDICT_ORDER: readonly RenderVerdict[] = ["credit", "silent", "late-bound", "unresolved"];

export type RenderOutcome =
  | { kind: "credit"; terminals: readonly [Terminal, ...Terminal[]] }
  | { kind: "silent"; because: "host-string" | "opaque" }
  | { kind: "diagnose"; code: "late-bound-render" | "unresolved-reference" };

/** The terminals a render of this value credits (`RENDER_VERDICT` "credit").
 *  The holder fold and argument-site seeding call it too. Empty when nothing
 *  is credited. */
export function creditedTerminals(e: readonly Terminal[]): Terminal[] {
  return e.filter((t) => matchDenotation(t, RENDER_VERDICT) === "credit");
}

const IS_CALLABLE: DenotationCases<boolean> = {
  element: () => false,
  foreign: () => false,
  "host-string": () => false,
  opaque: () => false,
  "late-bound": () => false,
  data: () => false,
  indeterminate: () => false,
  callable: () => true,
};

/** True when this terminal is a function a tag renders. */
export function isCallable(t: Terminal): boolean {
  return matchDenotation(t, IS_CALLABLE);
}

export function renderOutcome(e: Evaluation): RenderOutcome {
  const verdicts = e.map((t) => matchDenotation(t, RENDER_VERDICT));
  const winner = VERDICT_ORDER.find((v) => verdicts.includes(v)) ?? "unresolved";
  const first = e[verdicts.indexOf(winner)] ?? e[0];
  switch (winner) {
    case "credit":
      return { kind: "credit", terminals: creditedTerminals(e) as [Terminal, ...Terminal[]] };
    case "silent":
      return { kind: "silent", because: first.denotation.kind === "opaque" ? "opaque" : "host-string" };
    case "late-bound":
      return { kind: "diagnose", code: "late-bound-render" };
    case "unresolved":
      return { kind: "diagnose", code: "unresolved-reference" };
  }
}
