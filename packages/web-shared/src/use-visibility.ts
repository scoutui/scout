import { isKind, type Credit, type TraceStep } from "@scoutui/scan-format";

/**
 * What can pass a use props it doesn't write: a spread (`{...rest}`), or the call or wrapper the component is handed
 * to, by name (`useModal`, `withTheme`). A use with none of these is fully seen: the props it writes are all it passes.
 */
export type UnseenBy = { kind: "spread" } | { kind: "via"; callee: string };

/** A use as the scan file and the stored occurrence row both describe it. */
export type UseShape = { propNames: Iterable<string>; credit: Credit; trace: readonly TraceStep[] };

const SPREAD: UnseenBy = { kind: "spread" };

/**
 * What can pass the use props it doesn't write, or null for a fully seen use. A spread comes first, then the call the
 * component is passed to, then the outermost wrapper. Every wrapper counts, marked `mayAddProps` or not.
 */
export function unseenBy(use: UseShape): UnseenBy | null {
  for (const name of use.propNames) if (name.startsWith("...")) return SPREAD;
  if (isKind(use.credit, "argument")) return { kind: "via", callee: use.credit.callee };
  for (const step of use.trace) if (isKind(step, "hoc")) return { kind: "via", callee: step.callee };
  return null;
}
