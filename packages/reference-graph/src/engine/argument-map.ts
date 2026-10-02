import type { InferredType, Reference } from "../index.js";

/**
 * Argument map: substitution table for ParameterOf nodes.
 *
 * When `resolveType` walks `ReturnTypeOf(callee, args)`, it binds `args` to
 * the callee function's parameters. Any `ParameterOf(fn, i)` encountered
 * during resolution of the function's return type substitutes via this map.
 */
export interface ArgumentMap {
  bind(fn: Reference, args: InferredType[]): void;
  unbind(fn: Reference): void;
  lookup(fn: Reference, index: number): InferredType | undefined;
}

/** The argument the call the walk is inside bound to this parameter, or
 *  undefined when it bound none. The algebra's substitution, the
 *  component-shape predicate and the walker's late-bound naming all read a
 *  `ParameterOf` through it. */
export function boundArgument(
  argMap: ArgumentMap,
  param: Extract<InferredType, { kind: "ParameterOf" }>,
): InferredType | undefined {
  return argMap.lookup(param.fn, param.index);
}

/** Key an ArgumentMap frame by. Exported so wrapper-folding's structural
 *  pass-through check compares `ParameterOf.fn` against a callee's
 *  `bindingRef` exactly the way `lookup` would. */
export function argumentRefKey(ref: Reference): string {
  return `${ref.symbol}::${ref.scope}`;
}

export function createArgumentMap(): ArgumentMap {
  const stack: Array<{ key: string; args: InferredType[] }> = [];
  return {
    bind(fn, args) {
      stack.push({ key: argumentRefKey(fn), args });
    },
    unbind(fn) {
      const key = argumentRefKey(fn);
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]?.key === key) {
          stack.splice(i, 1);
          return;
        }
      }
    },
    lookup(fn, index) {
      const key = argumentRefKey(fn);
      for (let i = stack.length - 1; i >= 0; i--) {
        const frame = stack[i];
        if (frame?.key === key) return frame.args[index];
      }
      return undefined;
    },
  };
}
