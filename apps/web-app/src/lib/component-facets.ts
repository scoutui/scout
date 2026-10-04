// Client-side faceted filtering for the repo-detail components table. The repo
// page sends every row to the browser on first load, so filtering runs locally.
//
// `FacetState` is kept in the page URL, one param per value (`FACET_PARAMS`).
// Facets combine with AND, and the values within a facet with OR.

import type { ComponentRow } from "@scoutui/web-shared";
import { friendlyKind, type QueryView } from "@scoutui/web-shared/client";
import { hrefWithQuery, type QueryParams } from "@/lib/query-string";

export type OriginValue = "external" | "local";
export type KindValue = QueryView["kind"];
export type OccurrenceOp = ">" | ">=" | "<" | "<=" | "=";

export type FacetState = {
  text: string; // free-text name search (case-insensitive substring on displayName)
  origin: OriginValue | null; // a component is either external or local, so single-select
  kinds: KindValue[]; // OR within
  packages: string[]; // OR within
  tags: string[]; // OR within (a row matches if it carries any selected tag)
  deprecated: boolean | null; // true = only deprecated, false = only not-deprecated, null = any
  changed: boolean; // true = only rows that moved since the last scan (needs the diff's marks; applied by the explorer)
  occurrences: { op: OccurrenceOp; value: number } | null;
};

export function emptyFacets(): FacetState {
  return { text: "", origin: null, kinds: [], packages: [], tags: [], deprecated: null, changed: false, occurrences: null };
}

export const KIND_LABEL: Record<KindValue, string> = {
  react: "React",
  vue: "Vue",
  wc: "Web component",
  "undefined-element": "Undefined element",
};

export const ORIGIN_LABEL: Record<OriginValue, string> = {
  external: "External",
  local: "Local",
};

export const NO_PACKAGE_TITLE = "no import links this component to a package";

export const ORIGIN_DESCRIPTION: Record<OriginValue, string> = {
  external: "From outside this repo",
  local: "Defined in this repo",
};

/** True when any facet is active (i.e. the row set is being narrowed). */
export function isFiltering(f: FacetState): boolean {
  return (
    f.text.trim() !== "" ||
    f.origin !== null ||
    f.kinds.length > 0 ||
    f.packages.length > 0 ||
    f.tags.length > 0 ||
    f.deprecated !== null ||
    f.occurrences !== null ||
    f.changed
  );
}

function occurrenceMatches(n: number, op: OccurrenceOp, v: number): boolean {
  switch (op) {
    case ">": return n > v;
    case ">=": return n >= v;
    case "<": return n < v;
    case "<=": return n <= v;
    case "=": return n === v;
  }
}

/** The written name the search text finds a row by, when its display name doesn't contain the text. */
export function writtenNameMatch(r: ComponentRow, text: string): string | undefined {
  const needle = text.trim().toLowerCase();
  if (!needle || r.displayName.toLowerCase().includes(needle)) return undefined;
  return r.writtenNames?.find((name) => name.toLowerCase().includes(needle));
}

/** Does a row match the facets? `changed` is the explorer's to apply; this never reads it. */
function matchesRow(r: ComponentRow, f: FacetState): boolean {
  const text = f.text.trim().toLowerCase();
  if (text && !r.displayName.toLowerCase().includes(text) && writtenNameMatch(r, text) === undefined) return false;
  if (f.origin && r.scope !== f.origin) return false;
  if (f.kinds.length && !f.kinds.includes(friendlyKind(r.kind))) return false;
  if (f.packages.length && !(r.packageName !== null && f.packages.includes(r.packageName))) return false;
  if (f.tags.length) {
    const rowTags = r.tags ?? [];
    if (!rowTags.some((t) => f.tags.includes(t.value))) return false;
  }
  if (f.deprecated !== null && r.deprecated !== f.deprecated) return false;
  if (f.occurrences && !occurrenceMatches(r.occurrenceCount, f.occurrences.op, f.occurrences.value)) return false;
  return true;
}

/** Apply the facet state to the full row set. Pure; memoise at the call site. */
export function filterRows(rows: ComponentRow[], f: FacetState): ComponentRow[] {
  return rows.filter((r) => matchesRow(r, f));
}

/** What the Filter menu and the status chips offer, each value with its count. */
export type FacetOptions = {
  origin: { external: number; local: number };
  kinds: { value: KindValue; count: number }[];
  packages: { value: string; count: number }[];
  tags: { value: string; color: string; count: number }[];
  deprecatedCount: number;
  /** Rows the changed view shows under the other filters; null when there is no
   *  changed view to offer (a first scan, or no row moved). */
  changedCount: number | null;
  /** The most each chip's count can read under any filters (every deprecated
   *  row, ghosts included; every changed-view row), so a chip can reserve that
   *  width and a count narrowing from 14 to 7 never slides the controls after it. */
  deprecatedMax: number;
  changedMax: number;
};

/**
 * Faceted counts: each count is the rows matching all the other active filters
 * (search text, occurrences and the statuses included). A facet ignores its own
 * selections, so a second package stays offered at its real count while every
 * other filter narrows the list. Counts are rows, through `matchesRow`.
 *
 * Every value the page knows (live rows and removed ghosts) is listed, zero
 * counts included, and so is any selected value it doesn't know: the menu can
 * tell "this repo has no tags" from "no tag matches the other filters", and a
 * selection stays visible at 0 so it can be unticked, even one missing from the
 * changed view's smaller set. Hiding zeros is the menu's job.
 *
 * `all` is every live row. `changed` is the changed view's candidates (marked
 * rows plus the removed ghosts), null when there is no changed view. Counts run
 * over `changed` when the changed view is on, otherwise over `all`. The chip counts
 * `changed` under every other filter, since the explorer applies `changed`
 * itself.
 */
export function facetOptions(
  all: readonly ComponentRow[],
  changed: readonly ComponentRow[] | null,
  f: FacetState,
): FacetOptions {
  const base = f.changed && changed !== null ? changed : all;
  const inBase = new Set(base.map((r) => r.componentId));
  const liveIds = new Set(all.map((r) => r.componentId));
  const known = changed === null ? all : [...all, ...changed.filter((r) => !liveIds.has(r.componentId))];
  const withoutOrigin: FacetState = { ...f, origin: null };
  const withoutKinds: FacetState = { ...f, kinds: [] };
  const withoutPackages: FacetState = { ...f, packages: [] };
  const withoutTags: FacetState = { ...f, tags: [] };
  const withoutDeprecated: FacetState = { ...f, deprecated: null };

  const origin = { external: 0, local: 0 };
  const kindCounts = new Map<KindValue, number>(f.kinds.map((k) => [k, 0]));
  const pkgCounts = new Map<string, number>(f.packages.map((p) => [p, 0]));
  const tagCounts = new Map<string, { color: string; count: number }>(f.tags.map((t) => [t, { color: "", count: 0 }]));
  let deprecatedCount = 0;

  for (const r of known) {
    const counted = inBase.has(r.componentId);
    origin[r.scope] += counted && matchesRow(r, withoutOrigin) ? 1 : 0;
    const kind = friendlyKind(r.kind);
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + (counted && matchesRow(r, withoutKinds) ? 1 : 0));
    if (r.packageName) {
      pkgCounts.set(r.packageName, (pkgCounts.get(r.packageName) ?? 0) + (counted && matchesRow(r, withoutPackages) ? 1 : 0));
    }
    const inTags = counted && matchesRow(r, withoutTags) ? 1 : 0;
    for (const [value, color] of new Map((r.tags ?? []).map((t) => [t.value, t.color]))) {
      tagCounts.set(value, { color, count: (tagCounts.get(value)?.count ?? 0) + inTags });
    }
    if (counted && r.deprecated && matchesRow(r, withoutDeprecated)) deprecatedCount++;
  }

  const kinds = (Object.keys(KIND_LABEL) as KindValue[])
    .filter((k) => kindCounts.has(k))
    .map((k) => ({ value: k, count: kindCounts.get(k) ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const packages = [...pkgCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const tags = [...tagCounts.entries()]
    .map(([value, { color, count }]) => ({ value, color, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const changedCount = changed === null ? null : changed.filter((r) => matchesRow(r, f)).length;

  return {
    origin,
    kinds,
    packages,
    tags,
    deprecatedCount,
    changedCount,
    deprecatedMax: known.filter((r) => r.deprecated).length,
    changedMax: changed?.length ?? 0,
  };
}

// --- URL params ---------------------------------------------------------------

/** The params the components table keeps its facets in. */
export const FACET_PARAMS = ["q", "origin", "kind", "package", "tag", "deprecated", "uses", "changed"];

const KINDS: readonly KindValue[] = ["react", "vue", "wc", "undefined-element"];
const OCCURRENCE_WORDS: Record<OccurrenceOp, string> = { ">=": "gte:", ">": "gt:", "<=": "lte:", "<": "lt:", "=": "" };
const OCCURRENCE_RE = /^(gte:|gt:|lte:|lt:)?(\d+)$/;

/** A link to a repo's components table filtered to one package. */
export function packageFilterHref(repoId: string, packageName: string): string {
  return hrefWithQuery(`/repos/${encodeURIComponent(repoId)}`, facetsToParams({ ...emptyFacets(), packages: [packageName] }));
}

export function facetsToParams(f: FacetState): QueryParams {
  const params: [string, string][] = [];
  // Untrimmed, so a trailing space survives while the user is still typing; matching trims.
  if (f.text.trim() !== "") params.push(["q", f.text]);
  if (f.origin) params.push(["origin", f.origin]);
  for (const kind of f.kinds) params.push(["kind", kind]);
  for (const pkg of f.packages) params.push(["package", pkg]);
  for (const tag of f.tags) params.push(["tag", tag]);
  if (f.deprecated !== null) params.push(["deprecated", String(f.deprecated)]);
  if (f.occurrences) params.push(["uses", `${OCCURRENCE_WORDS[f.occurrences.op]}${f.occurrences.value}`]);
  if (f.changed) params.push(["changed", "true"]);
  return params;
}

/** Facet state from the URL. Values it doesn't know are skipped, so a hand-edited link reads as far as it can. */
export function paramsToFacets(params: URLSearchParams): FacetState {
  const f = emptyFacets();
  f.text = params.get("q") ?? "";
  const origin = params.get("origin");
  if (origin === "external" || origin === "local") f.origin = origin;
  f.kinds = [...new Set(params.getAll("kind"))].filter((k): k is KindValue => KINDS.includes(k as KindValue));
  f.packages = [...new Set(params.getAll("package"))].filter(Boolean);
  f.tags = [...new Set(params.getAll("tag"))].filter(Boolean);
  const deprecated = params.get("deprecated");
  if (deprecated === "true" || deprecated === "false") f.deprecated = deprecated === "true";
  f.changed = params.get("changed") === "true";
  const om = OCCURRENCE_RE.exec(params.get("uses") ?? "");
  if (om) {
    const op = (Object.keys(OCCURRENCE_WORDS) as OccurrenceOp[]).find((k) => OCCURRENCE_WORDS[k] === (om[1] ?? ""));
    if (op) f.occurrences = { op, value: Number(om[2]) };
  }
  return f;
}
