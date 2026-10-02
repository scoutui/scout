/**
 * A non-empty reason for an error. An AggregateError, such as every address of `localhost` refusing a
 * connection, has an empty message of its own, so its inner errors' reasons stand in for it.
 */
export function failureReason(error) {
  return error.message || error.errors?.map(failureReason).join("; ") || error.code || String(error);
}
