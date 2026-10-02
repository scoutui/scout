/**
 * Narrow an unknown thrown value to a string for a user-facing message.
 * Thrown values aren't always Errors, so use this rather than
 * `(e as Error).message`.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * Same idea for stack traces. Returns the stack if the value is an Error with
 * one, otherwise falls back to errorMessage.
 */
export function errorStack(e: unknown): string {
  if (e instanceof Error && e.stack) return e.stack;
  return errorMessage(e);
}
