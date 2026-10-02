"use client";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { hrefWithQuery, queryString, type QueryParams } from "@/lib/query-string";

/** Replaces the `owned` params in the current URL with `params`, keeping the rest. */
function replaceParams(owned: readonly string[], params: QueryParams): void {
  const kept = [...new URLSearchParams(window.location.search)].filter(([name]) => !owned.includes(name));
  window.history.replaceState(null, "", hrefWithQuery(window.location.pathname, [...kept, ...params]) + window.location.hash);
}

/**
 * Client state kept in the search params named in `names`, one param per
 * value. The value comes from useSearchParams, which Next.js keeps in sync
 * with replaceState writes, not from a server-passed initial value: back and
 * forward navigation restore the router-cached RSC payload with its stale
 * props, which would bring a dismissed filter back.
 *
 * Writes go through history.replaceState (no server round trip); other params
 * (such as `scan`) are kept. `names`, `parse` and `serialize` must be stable
 * references (module-level).
 */
export function useQueryParamsState<T>(
  names: readonly string[],
  parse: (params: URLSearchParams) => T,
  serialize: (state: T) => QueryParams,
): [T, (next: T) => void] {
  const searchParams = useSearchParams();
  const own = queryString([...searchParams].filter(([name]) => names.includes(name)));
  const value = useMemo(() => parse(new URLSearchParams(own)), [parse, own]);
  const setValue = useCallback((next: T) => replaceParams(names, serialize(next)), [names, serialize]);
  return [value, setValue];
}

/** The same for state kept in one param: `?q=` unless `param` names another. */
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
      const nextQ = serialize(next);
      replaceParams([param], nextQ ? [[param, nextQ]] : []);
    },
    [serialize, param],
  );
  return [value, setValue];
}
