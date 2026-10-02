/**
 * Exhaustiveness guard for every `switch (type.kind)` over `InferredType`.
 * Reaching it is a type error at compile time, so adding a kind to the IR
 * fails to build in every interpreter, and an error at runtime when a cast
 * bypasses TypeScript.
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled InferredType kind: ${JSON.stringify(x)}`);
}
