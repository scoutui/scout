import type {
  CohortSelector,
  CohortSeries,
  DashboardConfig,
  DashboardScope,
  GovernanceRecord,
} from "./dto.js";
import type { DigestScan } from "./digest.js";
import { cohortKey, projectRepoCoverage, projectSeries, type RepoCoverage, type SeriesCohort } from "./cohorts.js";
import { governanceHash, governedComponentIds, type GovernanceRule } from "./governance.js";
import { newestScanFirst, scanOrderTime } from "./scan-order.js";

const CHANGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Per-digest-set memo: `deriveChartResults` derives tracking from one digest array
 * several times (the estate, each repo, and again in `deriveRecordStats`). Keyed
 * on the array's identity, so it only serves a result computed from that exact
 * array, and entries are collected with it. The inner key covers everything else
 * the derivation reads.
 */
const trackingMemo = new WeakMap<object, Map<string, GovernanceTracking[]>>();

/**
 * One governance record projected into a trackable chart definition. Series are
 * display-ready (clipped by the observation-window rule and role-stamped), so
 * rows, sparklines and detail pages never re-derive windowing: a series starts
 * at the first scan where the deprecated side is observed, because earlier
 * points reflect scan coverage, not migration state. Each side counts the
 * components its rule governs in each scan (`governedComponentIds`); the
 * config's cohorts name them: the package for a package-wide side, else one
 * component cohort per component the side governs in some in-scope scan.
 * A migration's successor cohorts, series, coverage and progress cover only
 * the repos that have used the deprecated side in some scan, so a repo that
 * only uses the successor doesn't count; with no such repo, `progress` is null.
 *
 * `delta` is the change in `remaining` over the 30 days up to the derivation's
 * `asOf`, each repo in scope compared with itself (from its first scan when it
 * joined inside the window). Null until some repo with old uses has two scans.
 * `reposAdded` counts the repos that joined inside the window and still have
 * old uses, when some repo was scanned before it.
 */
export type GovernanceTracking = {
  id: string;
  kind: "migration" | "retirement";
  record: GovernanceRecord;
  recordIds: string[];
  name: string;
  fromLabel: string;
  toLabel: string | null;
  config: DashboardConfig;
  series: CohortSeries[];
  coverage: RepoCoverage;
  active: boolean;
  remaining: number;
  progress: number | null;
  delta: number | null;
  reposAdded: number;
};

/**
 * Governance records + digests + scope → tracking entries, sorted most-remaining
 * first. A record needs no other opt-in to be tracked:
 * `superseded` → migration (count-trend pair, progress = successor ÷ pair),
 * `retired` → retirement (single count-trend, remaining + Δ, and no percent
 * without a pair). Superseded records that name the same replacement are one
 * migration of all their components, with the oldest record's id. Records that
 * govern nothing in any in-scope scan are skipped, so under a repo scope only the
 * records that apply to that repo remain.
 */
export function deriveGovernanceTracking(
  records: GovernanceRecord[],
  digests: DigestScan[],
  scope: DashboardScope,
  asOf: string,
): GovernanceTracking[] {
  return track("merged", records, digests, scope, asOf);
}

/** `deriveGovernanceTracking` with one entry per record, never merged. */
export function deriveRecordTracking(
  records: GovernanceRecord[],
  digests: DigestScan[],
  scope: DashboardScope,
  asOf: string,
): GovernanceTracking[] {
  return track("records", records, digests, scope, asOf);
}

function track(
  grouping: "merged" | "records",
  records: GovernanceRecord[],
  digests: DigestScan[],
  scope: DashboardScope,
  asOf: string,
): GovernanceTracking[] {
  const scopeKey = `${scope.kind === "repo" ? `repo:${scope.repoId}` : "all"}:${Date.parse(asOf)}`;
  const innerKey = `${grouping}::${scopeKey}::gov=${governanceHash(records)}`;
  let perDigests = trackingMemo.get(digests);
  const hit = perDigests?.get(innerKey);
  if (hit !== undefined) return hit;

  const groups = grouping === "merged" ? byReplacement(records) : records.map((record) => [record]);
  if (grouping === "merged" && groups.every((group) => group.length === 1)) return track("records", records, digests, scope, asOf);
  const scans = scope.kind === "repo" ? digests.filter((d) => d.meta.repo.id === scope.repoId) : digests;
  const out: GovernanceTracking[] = [];
  for (const members of groups) {
    const entry = deriveOne(members, records, scans, scope, asOf);
    if (entry) out.push(entry);
  }
  out.sort((a, b) => b.remaining - a.remaining);

  if (!perDigests) {
    perDigests = new Map();
    trackingMemo.set(digests, perDigests);
  }
  perDigests.set(innerKey, out);
  return out;
}

/** Each retired record on its own, and superseded records grouped by the replacement they name, oldest first. */
function byReplacement(records: GovernanceRecord[]): GovernanceRecord[][] {
  const groups = new Map<string, GovernanceRecord[]>();
  for (const record of records) {
    const by = record.disposition.kind === "superseded" ? record.disposition.by : null;
    const key = by ? `by:${by.packageName}\u0000${by.exportName ?? ""}` : `record:${record.id}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.values()].map((group) =>
    group.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
}

/** One side of a tracked entry: the rules that govern something in scope, and the components they govern in each scan. */
type Side<R extends GovernanceRule> = {
  rules: R[];
  label: string;
  ids: Set<string>;
  cohorts: CohortSelector[];
  occurrences: (scan: DigestScan) => number;
};

function sideOf<R extends GovernanceRule>(rules: R[], records: GovernanceRecord[], scans: DigestScan[], role?: "successor"): Side<R> {
  const tagged = role ? { role } : {};
  const governing = rules.flatMap((rule) => {
    const governed = new Map(scans.map((s) => [s.meta.scanId, governedComponentIds(rule, s, records)]));
    const ids = new Set([...governed.values()].flatMap((members) => [...members]));
    return ids.size > 0 ? [{ rule, governed, ids }] : [];
  });
  const cohorts = new Map<string, CohortSelector>();
  for (const { rule, ids } of governing) {
    const selectors: CohortSelector[] = rule.grain === "package"
      ? [{ kind: "package", packageName: rule.targetPackage, ...tagged }]
      : [...ids].sort().map((componentId) => ({ kind: "component", componentId, ...tagged }));
    for (const selector of selectors) cohorts.set(cohortKey(selector), selector);
  }
  const memberSets = (scanId: string) => governing.map(({ governed }) => governed.get(scanId));
  return {
    rules: governing.map(({ rule }) => rule),
    label: labelOf(governing.map(({ rule }) => rule)),
    ids: new Set(governing.flatMap(({ ids }) => [...ids])),
    cohorts: [...cohorts.values()],
    occurrences: (scan) => {
      const members = memberSets(scan.meta.scanId);
      return scan.components.reduce((n, c) => (members.some((m) => m?.has(c.id)) ? n + c.stats.occurrenceCount : n), 0);
    },
  };
}

const LABEL_PARTS = 4;

/** "Button · @acme/ui" for one rule; "Card, CardHeader · @acme/ui" for several in one package, then "+N more" past four. */
function labelOf(rules: GovernanceRule[]): string {
  const own = (rule: GovernanceRule) => (rule.targetExport === null ? rule.targetPackage : `${rule.targetExport} · ${rule.targetPackage}`);
  const capped = (parts: string[]) =>
    `${parts.slice(0, LABEL_PARTS).join(", ")}${parts.length > LABEL_PARTS ? ` +${parts.length - LABEL_PARTS} more` : ""}`;
  const [first] = rules;
  if (rules.length === 1 && first) return own(first);
  const packages = new Set(rules.map((rule) => rule.targetPackage));
  if (packages.size > 1 || !first) return capped(rules.map(own).sort());
  if (rules.some((rule) => rule.targetExport === null)) return first.targetPackage;
  return `${capped(rules.map((rule) => rule.targetExport ?? "").sort())} · ${first.targetPackage}`;
}

function deriveOne(
  members: GovernanceRecord[],
  records: GovernanceRecord[],
  scans: DigestScan[],
  scope: DashboardScope,
  asOf: string,
): GovernanceTracking | null {
  // The deprecated side follows each record's grain: a component-grain record
  // charts its component, not its whole package.
  const from = sideOf(members, records, scans);
  const [record] = from.rules;
  if (!record) return null;
  const fromLabel = from.label;
  const shortFrom = fromLabel.split(" · ")[0] ?? fromLabel;
  const deprecated: SeriesCohort = { key: `deprecated:${record.id}`, label: fromLabel, color: "", role: "deprecated", occurrences: from.occurrences };
  const change = changeIn(scans, from.occurrences, thirtyDaysBefore(asOf));

  if (record.disposition.kind === "retired") {
    const config: DashboardConfig = { scope, cohorts: from.cohorts, chartType: "trend", metric: "count" };
    const { series: counts, coverage } = clipToObservation(projectSeries(scans, [deprecated], "count"), projectRepoCoverage(scans));
    const remaining = at(counts[0], 1);
    return {
      id: `retirement:${record.id}`,
      kind: "retirement",
      record,
      recordIds: from.rules.map((r) => r.id),
      name: `Retirement: ${shortFrom}`,
      fromLabel,
      toLabel: null,
      config,
      series: counts,
      coverage,
      active: remaining > 0,
      remaining,
      progress: null,
      ...change,
    };
  }

  // Both sides count only in the repos that have used the deprecated side in some scan.
  const used = reposWithUses(scans, from.occurrences);
  const counting = scans.filter((s) => used.has(s.meta.repo.id));
  // Successor side: the component or package `by` names, matched like the deprecated side; 0 uses until a counting scan holds it.
  const by = record.disposition.by;
  const successorRule: GovernanceRule = by.exportName === undefined
    ? { grain: "package", targetPackage: by.packageName, targetExport: null }
    : { grain: "component", targetPackage: by.packageName, targetExport: by.exportName };
  const to = sideOf([successorRule], records, counting, "successor");
  const toLabel = labelOf([successorRule]);
  const successor: SeriesCohort = { key: `successor:${record.id}`, label: toLabel, color: "", role: "successor", occurrences: to.occurrences };

  // A migration charts two counts over time, like a retirement; its share is a
  // snapshot carried by the row readout.
  const config: DashboardConfig = { scope, cohorts: [...from.cohorts, ...to.cohorts], chartType: "trend", metric: "count" };
  // Counts are both the display series and the maths (progress = successor ÷ pair).
  const { series: counts, coverage } = clipToObservation(projectSeries(counting, [deprecated, successor], "count"), projectRepoCoverage(counting));
  const [dep, succ] = counts;
  const remaining = at(dep, 1);
  const progress = pairShare(at(dep, 1), at(succ, 1));
  return {
    id: `migration:${record.id}`,
    kind: "migration",
    record,
    recordIds: from.rules.map((r) => r.id),
    name: `Migration: ${shortFrom} → ${toLabel.split(" · ")[0] ?? toLabel}`,
    fromLabel,
    toLabel,
    config,
    series: counts,
    coverage,
    active: remaining > 0,
    remaining,
    progress,
    ...change,
  };
}

type Change = { delta: number | null; reposAdded: number };

function scansByRepo(scans: DigestScan[]): DigestScan[][] {
  const byRepo = new Map<string, DigestScan[]>();
  for (const scan of scans) {
    const repoScans = byRepo.get(scan.meta.repo.id) ?? [];
    repoScans.push(scan);
    byRepo.set(scan.meta.repo.id, repoScans);
  }
  return [...byRepo.values()].map((repoScans) => repoScans.sort((a, b) => newestScanFirst(a.meta, b.meta)));
}

/** The repos with at least one scan where the count is above 0. */
function reposWithUses(scans: DigestScan[], countOf: (scan: DigestScan) => number): Set<string> {
  const used = new Set<string>();
  for (const scan of scans) {
    if (!used.has(scan.meta.repo.id) && countOf(scan) > 0) used.add(scan.meta.repo.id);
  }
  return used;
}

/** Where the 30 days up to `asOf` start, in epoch ms. */
export function thirtyDaysBefore(asOf: string): number {
  return Date.parse(asOf) - CHANGE_WINDOW_MS;
}

/**
 * The change in a count per scan since `start`, in epoch ms: each repo's latest scan compared with its latest scan on
 * or before `start` (its first scan when it joined after it), added up across repos. `reposAdded` counts the repos
 * that joined after `start` and still have the count, when some repo was scanned before it. Null until some repo with
 * the count has two scans.
 */
export function changeIn(scans: DigestScan[], countOf: (scan: DigestScan) => number, start: number): Change {
  const counts = new Map(scans.map((scan) => [scan.meta.scanId, countOf(scan)]));
  const occurrences = (scan: DigestScan) => counts.get(scan.meta.scanId) ?? 0;
  const used = reposWithUses(scans, occurrences);
  const before = (scan: DigestScan) => Date.parse(scanOrderTime(scan.meta)) <= start;
  const noneBefore = !scans.some(before);
  let delta = 0;
  let reposAdded = 0;
  let reading = false;
  for (const repoScans of scansByRepo(scans)) {
    const latest = repoScans[0] as DigestScan;
    if (!used.has(latest.meta.repo.id)) continue;
    const first = repoScans[repoScans.length - 1] as DigestScan;
    const baseline = repoScans.find(before) ?? first;
    reading ||= repoScans.length >= 2;
    delta += occurrences(latest) - occurrences(baseline);
    if (!noneBefore && !before(first) && occurrences(latest) > 0) reposAdded++;
  }
  return { delta: reading ? delta : null, reposAdded };
}

/** Observation-window rule: drop leading timestamps where the deprecated series is 0, from the series and their coverage. */
function clipToObservation(series: CohortSeries[], coverage: RepoCoverage): { series: CohortSeries[]; coverage: RepoCoverage } {
  const deprecated = series.find((s) => s.role === "deprecated") ?? series[0];
  const firstObserved = deprecated?.points.findIndex((p) => p.value > 0) ?? 0;
  if (firstObserved <= 0) return { series, coverage };
  return {
    series: series.map((s) => ({ ...s, points: s.points.slice(firstObserved) })),
    coverage: { ...coverage, points: coverage.points.slice(firstObserved) },
  };
}

function at(series: CohortSeries | undefined, back: number): number {
  const points = series?.points ?? [];
  return points[points.length - back]?.value ?? 0;
}

function pairShare(dep: number, succ: number): number | null {
  return dep + succ > 0 ? succ / (dep + succ) : null;
}
