import type { InferredType } from "../types/inferred-type.js";

/**
 * The value an object literal writes for `member`, or undefined when it writes
 * none. A member every object inherits, such as `constructor` or `toString`,
 * is never one the literal writes.
 */
export function ownProp(obj: Extract<InferredType, { kind: "Object" }>, member: string): InferredType | undefined {
  return Object.hasOwn(obj.props, member) ? obj.props[member] : undefined;
}
