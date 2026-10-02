"use client";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";

/**
 * A single search param as the source of truth for client-side state. Defaults
 * to `?q=`; pass `param` to sync another (such as `pin` for the composition
 * tab's pinned path).
 *
 * The value comes from useSearchParams, which Next.js keeps in sync with
 * replaceState writes, not from a server-passed initial value: back and forward
 * navigation restore the router-cached RSC payload with its stale props, which
 * would bring a dismissed filter back.
 *
 * Writes go through history.replaceState (no server round trip); other params
 * (such as `scan`) are kept. `parse` and `serialize` must be stable references
 * (module-level functions).
 */
export function useQuerySyncedState<T>(
  parse: (q: string) => T,
  serialize: (state: T) => string,
  param = "q",
): [T, (next: T) => void] {
  const searchParams = useSearchParams();
  const q = searchParams.get(param) ?? "";
  const value = useMemo(() => parse(q), [parse, q]);

  const setValue = useCallback(
    (next: T) => {
      const url = new URL(window.location.href);
      const nextQ = serialize(next);
      if (nextQ) url.searchParams.set(param, nextQ);
      else url.searchParams.delete(param);
      window.history.replaceState(null, "", url.toString());
    },
    [serialize, param],
  );

  return [value, setValue];
}
