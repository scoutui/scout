"use client";
import { createContext, type Dispatch, type SetStateAction, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  DEFAULT_USAGE_SORT,
  type UsageFilters,
  type UsagePick,
  type UsagePickKind,
  type UsageSort,
  type UsageSortKey,
} from "@scoutui/web-shared/client";
import { hrefWithQuery } from "@/lib/query-string";
import { useQuerySyncedState } from "@/lib/use-query-synced-state";

/** The kinds a `sel` pick can name, and the kind each reads as: a variable (`ref`) reads as `{…}`. */
const PICK_KINDS = new Map<string, UsagePickKind>([
  ["value", "value"],
  ["ref", "dynamic"],
  ["dynamic", "dynamic"],
  ["unset", "unset"],
]);

/**
 * Reads `sel`: picks written `prop~kind~label` and joined by `,`, with `%` and `,` escaped inside each pick.
 * Only a written value keeps its label. Repeated picks and parts that aren't a pick are dropped.
 */
export function parseSel(raw: string): UsagePick[] {
  const picks: UsagePick[] = [];
  if (!raw) return picks;
  for (const part of raw.split(",")) {
    const [prop, kindText, ...rest] = part.replace(/%2C|%25/gi, (escaped) => (escaped === "%25" ? "%" : ",")).split("~");
    const kind = PICK_KINDS.get(kindText ?? "");
    if (!prop || !kind) continue;
    const label = kind === "value" ? rest.join("~") : "";
    if (picks.some((p) => p.prop === prop && p.kind === kind && p.label === label)) continue;
    picks.push({ prop, kind, label });
  }
  return picks;
}

export function serializeSel(picks: readonly UsagePick[]): string {
  return picks.map((p) => `${p.prop}~${p.kind}~${p.label}`.replaceAll("%", "%25").replaceAll(",", "%2C")).join(",");
}

const SORT = /^(calls|file|prop:[^~]+)~(asc|desc)$/;

/** Reads `sort`: `calls`, `file` or `prop:<name>`, then `~asc` or `~desc`. Anything else is the default sort. */
export function parseSort(raw: string): UsageSort {
  const match = SORT.exec(raw);
  return match ? { key: match[1] as UsageSortKey, dir: match[2] as UsageSort["dir"] } : DEFAULT_USAGE_SORT;
}

/** Writes `sort`; the default sort writes nothing. */
export function serializeSort(sort: UsageSort): string {
  return sort.key === DEFAULT_USAGE_SORT.key && sort.dir === DEFAULT_USAGE_SORT.dir ? "" : `${sort.key}~${sort.dir}`;
}

const sameText = (q: string) => q;
const parseArea = (q: string): string | null => q || null;
const serializeArea = (area: string | null) => area ?? "";

/** The Usage tab's filters, read from and written to the URL (`find`, `area`, `sel`, `sort`). */
export function useUsageFilters() {
  const [find, setFind] = useQuerySyncedState(sameText, sameText, "find");
  const [area, setArea] = useQuerySyncedState(parseArea, serializeArea, "area");
  const [picks, setPicks] = useQuerySyncedState<readonly UsagePick[]>(parseSel, serializeSel, "sel");
  const [sort, setSort] = useQuerySyncedState(parseSort, serializeSort, "sort");
  const filters = useMemo<UsageFilters>(() => ({ find, area, picks, sort }), [find, area, picks, sort]);
  /** Clears the picks and the folder, and keeps the search. */
  const clearFilters = useCallback(() => {
    setArea(null);
    setPicks([]);
  }, [setArea, setPicks]);
  return { filters, setFind, setArea, setPicks, setSort, clearFilters };
}

/** `pathname` + `search` with `params` set (null deletes one). */
export function hrefFrom(pathname: string, search: string, params: Record<string, string | null>): string {
  const query = new URLSearchParams(search);
  for (const [name, value] of Object.entries(params)) {
    if (value === null) query.delete(name);
    else query.set(name, value);
  }
  return hrefWithQuery(pathname, [...query]);
}

/** hrefFrom over the current `usePathname()` and `useSearchParams()`; safe during a server render. */
export function useHrefWith(): (params: Record<string, string | null>) => string {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return useCallback(
    (params: Record<string, string | null>) => hrefFrom(pathname, searchParams.toString(), params),
    [pathname, searchParams],
  );
}

/** Navigate to the current URL with `params` set, as a new history entry, without a server round trip. Click handlers only: it reads `window`. */
export function pushQuery(params: Record<string, string | null>): void {
  window.history.pushState(null, "", hrefFrom(window.location.pathname, window.location.search, params));
}

/** Where the reader was on one component's Usage tab: the page's scroll position and each kept value by its key. */
type Place = { componentId: string; y: number; values: Record<string, unknown> };
/** One component's Usage tab: the place Back restored, if any, and the values its parts keep. */
type Kept = { componentId: string; restored: Place | null; values: Map<string, unknown> };

const PLACE = "usagePlace";
const KeptContext = createContext<Kept | null>(null);
export const KeptProvider = KeptContext.Provider;

const noSubscribe = () => () => {};
function readPlace(componentId: string): Place | null {
  const place: Place | undefined = window.history.state?.[PLACE];
  return place?.componentId === componentId ? place : null;
}

/**
 * The Usage tab's kept values for `componentId`, starting from the place saved in this history entry when "Rendered
 * by" left it. A page the server rendered starts from nothing, so its first client render matches.
 */
export function useKeptPlace(componentId: string): Kept {
  const restored = useSyncExternalStore(noSubscribe, () => readPlace(componentId), () => null);
  const [kept] = useState<Kept>(() => ({ componentId, restored, values: new Map() }));
  return kept;
}

/**
 * State the Usage tab keeps for Back after "Rendered by". It starts from its latest value when its part mounts again,
 * such as the file list after a search that matched nothing, else from the value restored under `key`, else `initial`.
 */
export function useKept<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const kept = useContext(KeptContext);
  const [value, setValue] = useState<T>(() => {
    if (kept?.values.has(key)) return kept.values.get(key) as T;
    const restored = kept?.restored?.values;
    return restored && key in restored ? (restored[key] as T) : initial;
  });
  useEffect(() => {
    kept?.values.set(key, value);
  }, [kept, key, value]);
  return [value, setValue];
}

/** A function that saves the page's scroll position and the Usage tab's kept values in the current history entry. */
export function useKeepPlace(): () => void {
  const kept = useContext(KeptContext);
  return () => {
    if (!kept) return;
    const place: Place = { componentId: kept.componentId, y: window.scrollY, values: Object.fromEntries(kept.values) };
    window.history.replaceState({ ...window.history.state, [PLACE]: place }, "");
  };
}
