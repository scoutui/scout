import type { FileGraph, Graph, InferredType, Reference } from "../index.js";
import { bindingValue, resolveBinding } from "./binding.js";
import { createCycleGuard, type CycleGuard } from "./cycle-detection.js";

/** The value a reference names: `bindingValue` of its binding. `Unknown` for
 *  unresolved symbols and cycles. */
export function resolveReference(
  graph: Graph,
  fileGraph: FileGraph,
  ref: Reference,
  guard: CycleGuard = createCycleGuard(),
): InferredType {
  return bindingValue(resolveBinding(graph, fileGraph, ref, guard));
}
