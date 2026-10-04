/** An error's message, or for one with no message of its own, such as a refused connection to `localhost`, its inner errors' messages. */
export function errorReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.message) return error.message;
  if (error instanceof AggregateError && error.errors.length > 0) return error.errors.map(errorReason).join("; ");
  return String(error);
}
