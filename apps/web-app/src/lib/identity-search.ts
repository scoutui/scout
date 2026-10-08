import type { CohortSelector, GovernanceRecord, GovernanceTarget, TagRule } from "@scoutui/web-shared";
import { cohortKey, tagMatchesPackage, targetConflict } from "@scoutui/web-shared/client";
import type { PickableComponent } from "@/lib/chart-builder-series";

export type IdentityPick = { packageName: string; exportName?: string };

/**
 * A row the picker lists. Every row but a package to narrow to carries `pick`, what choosing it gives the
 * caller, and `added` when the search is for a list that adds several and that row is already added.
 */
export type SearchRow<T = IdentityPick> =
  /**
   * A package to narrow the search to. `matches` counts the names in it the search matches when the
   * package is offered for them, otherwise null; `narrowedQuery` is the search kept once narrowed.
   */
  | { kind: "package"; packageName: string; components: number; matches: number | null; narrowedQuery: string }
  | { kind: "whole"; packageName: string; components: number; refusal: string | null; pick: T; added?: boolean }
  | {
      kind: "component";
      packageName: string | null;
      exportName: string;
      /** Set when two components can share a package and name, with the path that tells them apart. */
      componentId?: string;
      disambiguator?: string | null;
      refusal: string | null;
      matched: Array<[number, number]>;
      pick: T;
      added?: boolean;
    }
  /** A tag, with how many of the listed packages it matches. */
  | { kind: "tag"; tagId: string; label: string; packages: number; matched: Array<[number, number]>; pick: T; added?: boolean }
  | { kind: "local"; label: string; components: number; matched: Array<[number, number]>; pick: T; added?: boolean };

export type SearchResult<T> = { rows: SearchRow<T>[]; defaultIndex: number | null; total: number | null };

export type SearchInput = {
  mode: "source" | "successor";
  sources: GovernanceTarget[];
  query: string;
  /** The package the search is narrowed to. */
  scope: string | null;
  records: GovernanceRecord[];
  /** The record being edited: its own target stays pickable. */
  editingId?: string | undefined;
  /** A target left out of the list. */
  exclude?: IdentityPick | null | undefined;
  /** In successor mode, narrowed to a package and with no search, names that share a word with this come first. */
  similarTo?: string | null | undefined;
};

export const MAX_PACKAGE_ROWS = 3;
export const MAX_LOCAL_PACKAGE_ROWS = 5;
export const MAX_COMPONENT_ROWS = 50;
export const LOCAL_COMPONENTS = "Local components";

type Range = [number, number];
type Word = { start: number; text: string };
type Match = { tier: number; matched: Range[] };

/** A name's words, lower-cased: split at anything but letters and digits, at capitals and at digits (`NButton` is `n`, `button`). */
function words(name: string): Word[] {
  return [...name.matchAll(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g)].map((m) => ({ start: m.index, text: m[0].toLowerCase() }));
}

/** The term split into parts that start consecutive words, the first word anywhere (`dp` in DialogPopup). */
function wordStarts(term: string, ws: Word[]): Range[] | null {
  const from = (at: number, wi: number): Range[] | null => {
    if (at === term.length) return [];
    const w = ws[wi];
    if (!w) return null;
    for (let k = Math.min(w.text.length, term.length - at); k >= 1; k--) {
      if (w.text.slice(0, k) !== term.slice(at, at + k)) continue;
      const rest = from(at + k, wi + 1);
      if (rest) return [[w.start, w.start + k], ...rest];
    }
    return null;
  };
  for (let wi = 0; wi < ws.length; wi++) {
    const found = from(0, wi);
    if (found) return found;
  }
  return null;
}

/**
 * How one lower-case term matches a name: 0 the whole name, 1 its start, 2 the start
 * of one of its words, 3 the starts of consecutive words, 4 the start of a word in
 * the package, 5 anywhere in either. Null when it doesn't match.
 */
function matchTerm(term: string, name: string, packageName: string | null): Match | null {
  const lower = name.toLowerCase();
  if (lower === term) return { tier: 0, matched: [[0, term.length]] };
  if (lower.startsWith(term)) return { tier: 1, matched: [[0, term.length]] };
  const ws = words(name);
  const word = ws.find((w) => w.text.startsWith(term));
  if (word) return { tier: 2, matched: [[word.start, word.start + term.length]] };
  const starts = term.length >= 2 ? wordStarts(term, ws) : null;
  if (starts) return { tier: 3, matched: starts };
  if (packageName !== null && words(packageName).some((w) => w.text.startsWith(term))) return { tier: 4, matched: [] };
  const at = lower.indexOf(term);
  if (at >= 0) return { tier: 5, matched: [[at, at + term.length]] };
  if (packageName?.toLowerCase().includes(term)) return { tier: 5, matched: [] };
  return null;
}

/**
 * How one lower-case term matches a package name: 0 the whole name, 1 its start or
 * the start of its first word after a leading `@`, 2 the start of any other word.
 * From a word's start the term runs on across separators: `example/new-ui` matches
 * `@example/new-ui` at 1, `old-ui` matches `@example/old-ui` at 2. Null when it
 * doesn't match.
 */
function matchPackageTerm(term: string, packageName: string): number | null {
  const lower = packageName.toLowerCase();
  if (lower === term) return 0;
  if (lower.startsWith(term)) return 1;
  const word = words(packageName).find((w) => lower.startsWith(term, w.start));
  if (!word) return null;
  return word.start === 1 && lower.startsWith("@") ? 1 : 2;
}

/** Every term must match; the weakest decides the tier. */
function matchAll(terms: string[], name: string, packageName: string | null): Match | null {
  let tier = 0;
  const ranges: Range[] = [];
  for (const term of terms) {
    const m = matchTerm(term, name, packageName);
    if (!m) return null;
    tier = Math.max(tier, m.tier);
    ranges.push(...m.matched);
  }
  return { tier, matched: merge(ranges) };
}

/** The ranges sorted by start, overlapping ones joined. */
function merge(ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/** Why a target can't take a new record, or null when it can. */
function refusal(pick: IdentityPick, records: GovernanceRecord[], editingId: string | undefined): string | null {
  const conflict = targetConflict(
    { grain: pick.exportName === undefined ? "package" : "component", targetPackage: pick.packageName, targetExport: pick.exportName ?? null },
    records,
    editingId,
  );
  if (conflict?.kind === "target_governed") return "Already recorded";
  if (conflict?.kind === "package_grain_overlap") return "Whole package recorded";
  if (conflict?.kind === "component_grain_overlap") {
    const n = conflict.existingIds.length;
    return `${n} component${n === 1 ? "" : "s"} already recorded`;
  }
  return null;
}

type Ranked<T> = { row: Extract<SearchRow<T>, { kind: "component" }>; tier: number; occurrences: number };

const byRank = <T>(a: Ranked<T>, b: Ranked<T>) =>
  a.tier - b.tier
  || b.occurrences - a.occurrences
  || a.row.exportName.localeCompare(b.row.exportName)
  || (a.row.packageName ?? "").localeCompare(b.row.packageName ?? "");

/** Refused rows go last within each run of rows with the same tier. */
function refusedLast<T>(ranked: Ranked<T>[]): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (let start = 0, i = 1; i <= ranked.length; i++) {
    if (i < ranked.length && ranked[i]?.tier === ranked[start]?.tier) continue;
    const run = ranked.slice(start, i);
    out.push(...run.filter((r) => r.row.refusal === null), ...run.filter((r) => r.row.refusal !== null));
    start = i;
  }
  return out;
}

function sharesWord(a: string, b: string): boolean {
  const other = new Set(words(b).map((w) => w.text));
  return words(a).some((w) => other.has(w.text));
}

/** How many components each package has among the targets. */
export function componentCounts(sources: { packageName: string; exportName?: string | undefined }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of sources) {
    if (s.exportName !== undefined) counts.set(s.packageName, (counts.get(s.packageName) ?? 0) + 1);
  }
  return counts;
}

const sameTarget = (a: IdentityPick, b: IdentityPick) =>
  a.packageName === b.packageName && (a.exportName ?? null) === (b.exportName ?? null);

/**
 * The rows the picker shows for a search, and the row Enter takes by default: the
 * first component that can be picked or, when no row is a component, the first
 * package row; otherwise none. Never a whole package. `total` is how many components
 * match when the list stops at `MAX_COMPONENT_ROWS`, otherwise null.
 *
 * A package only scanned repos define (`local`) lists after the installed ones. Until
 * the search is narrowed to it, its components stay out of the list: up to
 * `MAX_LOCAL_PACKAGE_ROWS` such packages follow the results instead, with how many of their
 * names match, keeping the words that didn't match the package's name.
 */
export function searchTargets(input: SearchInput): SearchResult<IdentityPick> {
  const terms = input.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const refuse = (pick: IdentityPick) => (input.mode === "source" ? refusal(pick, input.records, input.editingId) : null);
  const offered = (pick: IdentityPick) => !(input.mode === "successor" && input.exclude && sameTarget(pick, input.exclude));

  const components = componentCounts(input.sources);
  const local = new Set(input.sources.flatMap((s) => (s.local ? [s.packageName] : [])));
  const packages = new Map<string, number>();
  for (const s of input.sources) {
    if (s.exportName === undefined) packages.set(s.packageName, s.occurrences);
    else if (!packages.has(s.packageName)) packages.set(s.packageName, 0);
  }
  const packageRow = (packageName: string, matches: number | null = null, narrowedQuery = ""): SearchRow => ({
    kind: "package", packageName, components: components.get(packageName) ?? 0, matches, narrowedQuery,
  });
  const packageOrder = (a: string, b: string) =>
    Number(local.has(a)) - Number(local.has(b)) || (packages.get(b) ?? 0) - (packages.get(a) ?? 0) || a.localeCompare(b);

  const rank = (packageName: string | null, scoped: boolean): Ranked<IdentityPick>[] =>
    input.sources.flatMap((s): Ranked<IdentityPick>[] => {
      if (s.exportName === undefined || (packageName !== null && s.packageName !== packageName)) return [];
      const pick = { packageName: s.packageName, exportName: s.exportName };
      if (!offered(pick)) return [];
      const m = terms.length === 0 ? { tier: 0, matched: [] } : matchAll(terms, s.exportName, scoped ? null : s.packageName);
      if (!m) return [];
      return [{ row: { kind: "component", ...pick, refusal: refuse(pick), matched: m.matched, pick }, tier: m.tier, occurrences: s.occurrences }];
    }).sort(byRank);

  const rows: SearchRow[] = [];
  let total: number | null = null;
  if (input.scope === null) {
    if (terms.length === 0) {
      rows.push(...[...packages.keys()].sort(packageOrder).map((p) => packageRow(p)));
    } else {
      const matching = [...packages.keys()].flatMap((name) => {
        const tiers = terms.map((t) => matchPackageTerm(t, name));
        return tiers.every((t) => t !== null) ? [{ name, tier: Math.max(...tiers) }] : [];
      });
      matching.sort((a, b) => a.tier - b.tier || packageOrder(a.name, b.name));
      const named = matching.slice(0, MAX_PACKAGE_ROWS).map((p) => p.name);
      rows.push(...named.map((p) => packageRow(p)));
      const found = rank(null, false);
      const ranked = refusedLast(found.filter((r) => !local.has(r.row.pick.packageName)));
      if (ranked.length > MAX_COMPONENT_ROWS) total = ranked.length;
      rows.push(...ranked.slice(0, MAX_COMPONENT_ROWS).map((r) => r.row));
      const matchesIn = new Map<string, number>();
      for (const { row: { pick } } of found) {
        if (local.has(pick.packageName) && !named.includes(pick.packageName)) matchesIn.set(pick.packageName, (matchesIn.get(pick.packageName) ?? 0) + 1);
      }
      rows.push(...[...matchesIn].slice(0, MAX_LOCAL_PACKAGE_ROWS).map(([packageName, matches]) =>
        packageRow(packageName, matches, terms.filter((t) => !packageName.toLowerCase().includes(t)).join(" "))));
    }
  } else {
    const scope = input.scope;
    const whole = { packageName: scope };
    if (packages.has(scope) && offered(whole) && terms.every((t) => scope.toLowerCase().includes(t))) {
      rows.push({ kind: "whole", packageName: scope, components: components.get(scope) ?? 0, refusal: refuse(whole), pick: whole });
    }
    const ranked = rank(scope, true);
    const similarTo = input.mode === "successor" && terms.length === 0 ? input.similarTo : null;
    if (similarTo) {
      const similar = ranked.filter((r) => sharesWord(r.row.exportName, similarTo));
      const rest = ranked.filter((r) => !similar.includes(r));
      rows.push(...refusedLast(similar).map((r) => r.row), ...refusedLast(rest).map((r) => r.row));
    } else {
      rows.push(...refusedLast(ranked).map((r) => r.row));
    }
  }

  return { rows, defaultIndex: defaultIndex(rows), total };
}

const takesOne = <T>(row: SearchRow<T>) => row.kind === "component" || row.kind === "tag" || row.kind === "local";

/**
 * The row Enter takes by default: the first component, tag or Local components row that isn't
 * refused or, when there's no such row, the first row if it's a package; otherwise none. Never a
 * whole package.
 */
function defaultIndex<T>(rows: SearchRow<T>[]): number | null {
  const first = rows.findIndex((r) => takesOne(r) && !(r.kind === "component" && r.refusal !== null));
  if (first >= 0) return first;
  return !rows.some(takesOne) && rows[0]?.kind === "package" ? 0 : null;
}

type SeriesRanked = Ranked<CohortSelector> & { lastSeenAt: string | null };

/** Components in use first, as `byRank` ranks them, then those only older scans hold: by match, then the most recently held first. */
const bySeriesRank = (a: SeriesRanked, b: SeriesRanked) =>
  Number(a.lastSeenAt !== null) - Number(b.lastSeenAt !== null)
  || a.tier - b.tier
  || (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "")
  || byRank(a, b);

export type SeriesSearchInput = {
  tags: Array<{ id: string; label: string; rule: TagRule }>;
  components: PickableComponent[];
  packages: string[];
  query: string;
  /** The package the search is narrowed to. */
  scope: string | null;
  /** The `cohortKey` of each series the chart has. */
  added: ReadonlySet<string>;
};

/**
 * The chart builder's rows for a search, each picking a series, with the matchers and
 * ranking `searchTargets` uses. With nothing typed, it lists every tag, Local components,
 * then the packages by use. A search lists the tags and the Local components row it
 * matches, then up to `MAX_PACKAGE_ROWS` packages and `MAX_COMPONENT_ROWS` components;
 * `total` counts the components when the list stops there. Narrowed to a package, it
 * lists the whole package, then every component in it. Components and packages only older
 * scans hold follow every one in use, the most recently held first.
 */
export function searchSeries(input: SeriesSearchInput): SearchResult<CohortSelector> {
  const terms = input.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const isAdded = (sel: CohortSelector) => input.added.has(cohortKey(sel));
  const match = (name: string, packageName: string | null) =>
    terms.length === 0 ? { tier: 0, matched: [] } : matchAll(terms, name, packageName);

  const components = new Map<string, number>();
  const uses = new Map<string, number>();
  // When the newest scan holding a package's components was made; "" once a latest scan holds one.
  const lastSeen = new Map<string, string>();
  for (const c of input.components) {
    if (c.packageName === null) continue;
    components.set(c.packageName, (components.get(c.packageName) ?? 0) + 1);
    uses.set(c.packageName, (uses.get(c.packageName) ?? 0) + c.occurrences);
    const seen = lastSeen.get(c.packageName);
    lastSeen.set(c.packageName, seen === "" || c.lastSeenAt === null ? "" : seen === undefined || c.lastSeenAt > seen ? c.lastSeenAt : seen);
  }
  const goneSince = (packageName: string) => lastSeen.get(packageName) ?? "";
  const byUse = (a: string, b: string) =>
    Number(goneSince(a) !== "") - Number(goneSince(b) !== "")
    || (uses.get(b) ?? 0) - (uses.get(a) ?? 0)
    || goneSince(b).localeCompare(goneSince(a))
    || a.localeCompare(b);
  const packageRow = (packageName: string): SearchRow<CohortSelector> => ({
    kind: "package", packageName, components: components.get(packageName) ?? 0, matches: null, narrowedQuery: "",
  });

  const rank = (scope: string | null): SeriesRanked[] =>
    input.components.flatMap((c): SeriesRanked[] => {
      if (scope !== null && c.packageName !== scope) return [];
      const m = match(c.displayName, scope === null ? c.packageName : null);
      if (!m) return [];
      const pick: CohortSelector = { kind: "component", componentId: c.componentId };
      const row = {
        kind: "component" as const, packageName: c.packageName, exportName: c.displayName, componentId: c.componentId,
        disambiguator: c.disambiguator, refusal: null, matched: m.matched, pick, added: isAdded(pick),
      };
      return [{ row, tier: m.tier, occurrences: c.occurrences, lastSeenAt: c.lastSeenAt }];
    }).sort(bySeriesRank);

  const rows: SearchRow<CohortSelector>[] = [];
  let total: number | null = null;
  if (input.scope === null) {
    for (const tag of input.tags) {
      const m = match(tag.label, null);
      if (!m) continue;
      const pick: CohortSelector = { kind: "tag", tagId: tag.id };
      const packages = input.packages.filter((p) => tagMatchesPackage(tag, p)).length;
      rows.push({ kind: "tag", tagId: tag.id, label: tag.label, packages, matched: m.matched, pick, added: isAdded(pick) });
    }
    const local = match(LOCAL_COMPONENTS, null);
    if (local) {
      const pick: CohortSelector = { kind: "local" };
      const count = input.components.filter((c) => c.local).length;
      rows.push({ kind: "local", label: LOCAL_COMPONENTS, components: count, matched: local.matched, pick, added: isAdded(pick) });
    }
    if (terms.length === 0) {
      rows.push(...[...input.packages].sort(byUse).map(packageRow));
    } else {
      const matching = input.packages.flatMap((name) => {
        const tiers = terms.map((t) => matchPackageTerm(t, name));
        return tiers.every((t) => t !== null) ? [{ name, tier: Math.max(...tiers) }] : [];
      });
      matching.sort((a, b) => a.tier - b.tier || byUse(a.name, b.name));
      rows.push(...matching.slice(0, MAX_PACKAGE_ROWS).map((p) => packageRow(p.name)));
      const ranked = rank(null);
      if (ranked.length > MAX_COMPONENT_ROWS) total = ranked.length;
      rows.push(...ranked.slice(0, MAX_COMPONENT_ROWS).map((r) => r.row));
    }
  } else {
    const scope = input.scope;
    if (input.packages.includes(scope) && terms.every((t) => scope.toLowerCase().includes(t))) {
      const pick: CohortSelector = { kind: "package", packageName: scope };
      rows.push({ kind: "whole", packageName: scope, components: components.get(scope) ?? 0, refusal: null, pick, added: isAdded(pick) });
    }
    rows.push(...rank(scope).map((r) => r.row));
  }
  return { rows, defaultIndex: defaultIndex(rows), total };
}
