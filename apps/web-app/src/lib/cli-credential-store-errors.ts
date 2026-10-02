/** Prevents query parameters and database causes from escaping a credential operation. */
export async function withCredentialStoreError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error("CLI credential store unavailable");
  }
}
