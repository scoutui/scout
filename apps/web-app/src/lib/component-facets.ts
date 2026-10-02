// Client-side faceted filtering for the repo-detail components table. The repo
// page sends every row to the browser on first load, so filtering runs locally.
//
// `FacetState` serialises to the `?q=` liqe grammar the server understands
// (`packages/web-shared/src/query.ts`), with one client-only token:
// `changed:true` needs the scan diff, which only the repo page's DTO carries, so
// an API `?q=changed:true` narrows to nothing, as any unknown field does. Facets
// combine with AND, and the values within a facet with OR.

import type { ComponentRow } from "@scoutui/web-shared";
import { friendlyKind, type QueryView } from "@scoutui/web-shared/client";
import { joinTerms, nameTerm, orGroup, readTerms, term } from "@/lib/query-terms";

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
  tag: "Tag",
};

export const ORIGIN_LABEL: Record<OriginValue, string> = {
  external: "External",
  local: "Local",
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
 * over `changed` under `changed:true`, otherwise over `all`. The chip counts
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

// --- URL (?q=) round-trip -----------------------------------------------------

/** A `?q=` value that filters a repo's components table to one package. The
 *  canonical builder for cross-page deep links (e.g. package detail → repo). */
export function packageFilterQuery(packageName: string): string {
  return term("package", packageName);
}

/** Serialise facets to a liqe query string for the URL: AND across facets, OR
 *  within a multi-value facet, the shape `parseQuery` and liqe evaluate. */
export function facetsToQuery(f: FacetState): string {
  return joinTerms([
    nameTerm(f.text),
    f.origin ? `scope:${f.origin}` : "",
    orGroup("kind", f.kinds),
    orGroup("package", f.packages),
    orGroup("tag", f.tags),
    f.deprecated !== null ? `deprecated:${f.deprecated}` : "",
    f.occurrences ? `occurrences:${f.occurrences.op}${f.occurrences.value}` : "",
    f.changed ? "changed:true" : "",
  ]);
}

const FIELDS = ["name", "scope", "kind", "package", "tag", "deprecated", "occurrences", "changed"];
const OCCURRENCE_RE = /^(>=|<=|>|<|=)(\d+)$/;

/** Best-effort parse of a `?q=` string back into facet state. Flattens OR groups
 *  and ANDed tokens into facet lists: a lossless inverse of `facetsToQuery`, and
 *  a tolerant reader of hand-written simple queries. */
export function queryToFacets(q: string): FacetState {
  const f = emptyFacets();
  for (const { field, value: raw } of readTerms(q, FIELDS)) {
    switch (field) {
      case "name":
        f.text = raw;
        break;
      case "scope":
        if (raw === "external" || raw === "local") f.origin = raw;
        break;
      case "kind":
        if ((raw === "react" || raw === "vue" || raw === "wc" || raw === "tag") && !f.kinds.includes(raw)) f.kinds.push(raw);
        break;
      case "package":
        if (!f.packages.includes(raw)) f.packages.push(raw);
        break;
      case "tag":
        if (!f.tags.includes(raw)) f.tags.push(raw);
        break;
      case "deprecated":
        f.deprecated = raw === "true";
        break;
      case "changed":
        f.changed = raw === "true";
        break;
      case "occurrences": {
        const om = OCCURRENCE_RE.exec(raw);
        if (om) f.occurrences = { op: om[1] as OccurrenceOp, value: Number(om[2]) };
        break;
      }
    }
  }
  return f;
}
