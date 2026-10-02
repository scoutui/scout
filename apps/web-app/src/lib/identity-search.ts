import type { GovernanceRecord, GovernanceTarget } from "@scoutui/web-shared";
import { targetConflict } from "@scoutui/web-shared/client";

/** A package or component the picker offers, with its occurrences in each repo's latest scan. */
export type PickerTarget = GovernanceTarget;
export type IdentityPick = { packageName: string; exportName?: string };

export type SearchRow =
  | { kind: "package"; packageName: string; components: number }
  | { kind: "whole"; packageName: string; components: number; refusal: string | null }
  | { kind: "component"; packageName: string; exportName: string; refusal: string | null; matched: Array<[number, number]> };

export type SearchInput = {
  mode: "source" | "successor";
  sources: PickerTarget[];
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
export const MAX_COMPONENT_ROWS = 50;

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

type Ranked = { row: Extract<SearchRow, { kind: "component" }>; tier: number; occurrences: number };

const byRank = (a: Ranked, b: Ranked) =>
  a.tier - b.tier
  || b.occurrences - a.occurrences
  || a.row.exportName.localeCompare(b.row.exportName)
  || a.row.packageName.localeCompare(b.row.packageName);

/** Refused rows go last within each run of rows with the same tier. */
function refusedLast(ranked: Ranked[]): Ranked[] {
  const out: Ranked[] = [];
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
export function componentCounts(sources: PickerTarget[]): Map<string, number> {
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
 * package row; otherwise none. Never a whole package.
 */
export function searchTargets(input: SearchInput): { rows: SearchRow[]; defaultIndex: number | null } {
  const terms = input.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const refuse = (pick: IdentityPick) => (input.mode === "source" ? refusal(pick, input.records, input.editingId) : null);
  const offered = (pick: IdentityPick) => !(input.mode === "successor" && input.exclude && sameTarget(pick, input.exclude));

  const components = componentCounts(input.sources);
  const packages = new Map<string, number>();
  for (const s of input.sources) {
    if (s.exportName === undefined) packages.set(s.packageName, s.occurrences);
    else if (!packages.has(s.packageName)) packages.set(s.packageName, 0);
  }
  const packageRow = (packageName: string): SearchRow => ({
    kind: "package", packageName, components: components.get(packageName) ?? 0,
  });
  const byOccurrences = (a: string, b: string) =>
    (packages.get(b) ?? 0) - (packages.get(a) ?? 0) || a.localeCompare(b);

  const rank = (packageName: string | null, scoped: boolean): Ranked[] =>
    input.sources.flatMap((s): Ranked[] => {
      if (s.exportName === undefined || (packageName !== null && s.packageName !== packageName)) return [];
      const pick = { packageName: s.packageName, exportName: s.exportName };
      if (!offered(pick)) return [];
      const m = terms.length === 0 ? { tier: 0, matched: [] } : matchAll(terms, s.exportName, scoped ? null : s.packageName);
      if (!m) return [];
      return [{ row: { kind: "component", ...pick, refusal: refuse(pick), matched: m.matched }, tier: m.tier, occurrences: s.occurrences }];
    }).sort(byRank);

  const rows: SearchRow[] = [];
  if (input.scope === null) {
    if (terms.length === 0) {
      rows.push(...[...packages.keys()].sort(byOccurrences).map(packageRow));
    } else {
      const matching = [...packages.keys()].flatMap((name) => {
        const tiers = terms.map((t) => matchPackageTerm(t, name));
        return tiers.every((t) => t !== null) ? [{ name, tier: Math.max(...tiers) }] : [];
      });
      matching.sort((a, b) => a.tier - b.tier || byOccurrences(a.name, b.name));
      rows.push(...matching.slice(0, MAX_PACKAGE_ROWS).map((p) => packageRow(p.name)));
      rows.push(...refusedLast(rank(null, false)).slice(0, MAX_COMPONENT_ROWS).map((r) => r.row));
    }
  } else {
    const scope = input.scope;
    const whole = { packageName: scope };
    if (packages.has(scope) && offered(whole) && terms.every((t) => scope.toLowerCase().includes(t))) {
      rows.push({ kind: "whole", packageName: scope, components: components.get(scope) ?? 0, refusal: refuse(whole) });
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

  const firstPick = rows.findIndex((r) => r.kind === "component" && r.refusal === null);
  const defaultIndex = firstPick >= 0
    ? firstPick
    : !rows.some((r) => r.kind === "component") && rows[0]?.kind === "package" ? 0 : null;
  return { rows, defaultIndex };
}
