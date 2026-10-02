/**
 * Per-attribute usage emitted by a parser, in one of three tiers:
 * - written: a literal value present verbatim in source (incl. a folded
 *   literal set from a ternary), or boolean-shorthand `true`, or literal `null`.
 * - reference: a non-literal captured by name/path but not resolved.
 * - dynamic: opaque (call, spread, object/array, mixed template, etc.).
 */
export type PropUsage =
  | { name: string; tier: "written"; value: string | number | boolean | null }
  | { name: string; tier: "written"; valueSet: (string | number | boolean)[] }
  | { name: string; tier: "reference"; ref: string }
  | { name: string; tier: "dynamic" };
