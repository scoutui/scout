import type { CohortPoint, CohortRole, CohortSeries, CohortSelector, GovernanceRecord, Tag } from "./dto.js";
import type { ComponentDigest, DigestScan } from "./digest.js";
import { displayNameOf } from "@scoutui/scan-format";
import { resolveTags } from "./tags.js";
import { componentDeprecated } from "./governance.js";
import { disambiguatorOf, presentIdentity } from "./present-identity.js";
import { representativeUsage } from "./representative.js";
import { latestScanPerRepo, newestScanFirst, scanOrderTime } from "./scan-order.js";
import { isUsed, usedComponentKey } from "./usage.js";

// `usedKeys` (not a raw count): callers union the set across repos and scans, so a
// component present in N in-scope artifacts contributes one member, not N.
// Occurrences stay a plain sum, whatever the usage.
export type CohortValue = { occurrences: number; usedKeys: Set<string> };

/** Occurrences + used-component keys for one cohort within a single artifact. */
export function resolveCohort(selector: CohortSelector, artifact: DigestScan, tags: Tag[], governance: GovernanceRecord[] = []): CohortValue {
  let occurrences = 0;
  const usedKeys = new Set<string>();
  for (const c of artifact.components) {
    if (matches(selector, c, tags, governance)) {
      occurrences += c.stats.occurrenceCount;
      if (isUsed(c)) usedKeys.add(usedComponentKey(c));
    }
  }
  return { occurrences, usedKeys };
}

/** The `cohortKey` a selector's drawn cohort carries. */
export function cohortKey(selector: CohortSelector): string {
  switch (selector.kind) {
    case "local":
      return "local";
    case "package":
      return `package:${selector.packageName}`;
    case "component":
      return `component:${selector.componentId}`;
    case "tag":
      return `tag:${selector.tagId}`;
    default: {
      const _exhaustive: never = selector;
      return _exhaustive;
    }
  }
}

/**
 * Stable display key + label + colour for a selector; null when nothing can name it:
 * a component that no scan in `artifacts` holds (a saved label doesn't change that),
 * or a tag that isn't in `tags`.
 */
function cohortIdentity(selector: CohortSelector, artifacts: DigestScan[], tags: Tag[]): { key: string; label: string; color: string } | null {
  const key = cohortKey(selector);
  switch (selector.kind) {
    case "local":
      return { key, label: "Local", color: "" };
    case "package":
      return { key, label: selector.packageName, color: "" };
    case "component": {
      const c = representativeMember(selector.componentId, artifacts);
      if (c === null) return null;
      const packageName = presentIdentity(c).packageName;
      const auto = packageName ? `${displayNameOf(c)} · ${packageName}` : displayNameOf(c);
      return { key, label: selector.label ?? auto, color: "" };
    }
    case "tag": {
      const t = tags.find((x) => x.id === selector.tagId);
      return t ? { key, label: t.value, color: t.color } : null;
    }
    default: {
      const _exhaustive: never = selector;
      return _exhaustive;
    }
  }
}

/**
 * The component a `component` selector names, as its `representativeUsage` presents it
 * (a tag's package is that scan's attribution); null when no scan holds the id.
 */
function representativeMember(componentId: string, artifacts: DigestScan[]): ComponentDigest | null {
  const usages = artifacts.flatMap((a) => {
    const component = a.components.find((x) => x.id === componentId);
    return component ? [{ meta: a.meta, component }] : [];
  });
  return representativeUsage(usages)?.component ?? null;
}

/** What tells each component cohort apart from a same-named one (see `disambiguatorOf`), by `cohortKey`; a component with nothing to tell it apart is left out. */
export function componentDisambiguators(cohorts: CohortSelector[], artifacts: DigestScan[]): Record<string, string> {
  return Object.fromEntries(cohorts.flatMap((selector) => {
    if (selector.kind !== "component") return [];
    const c = representativeMember(selector.componentId, artifacts);
    const path = c === null ? null : disambiguatorOf(presentIdentity(c));
    return path === null ? [] : [[cohortKey(selector), path]];
  }));
}

/**
 * Governance-derived role, scoped to wholly governed cohorts:
 * a package cohort only reds on a package-grain record (component-grain records
 * make it partial); a component cohort reds when its representative member is deprecated
 * (by `componentDeprecated`, where component-grain beats package-grain). A
 * `deprecatedOnly` selector is wholly deprecated by construction. Derived
 * deprecated wins over a config-carried successor role, so a successor that
 * becomes deprecated itself (a chained migration) goes red.
 */
function cohortRole(selector: CohortSelector, artifacts: DigestScan[], governance: GovernanceRecord[]): CohortRole | undefined {
  switch (selector.kind) {
    case "local":
      return undefined;
    case "tag":
      return selector.deprecatedOnly ? "deprecated" : undefined;
    case "package": {
      if (selector.deprecatedOnly) return "deprecated";
      if (governance.some((r) => r.grain === "package" && r.targetPackage === selector.packageName)) return "deprecated";
      return selector.role;
    }
    case "component": {
      const c = representativeMember(selector.componentId, artifacts);
      return c !== null && componentDeprecated(c, governance) ? "deprecated" : selector.role;
    }
    default: {
      const _exhaustive: never = selector;
      return _exhaustive;
    }
  }
}

type CohortMeta = { selector: CohortSelector; key: string; label: string; color: string; role?: CohortRole };

/**
 * The cohorts a chart draws, in order, each with its display key, label, colour and
 * semantic role, named from `artifacts`. A cohort nothing can name is left out (see
 * `cohortIdentity`); every other cohort is drawn, whatever its value.
 */
function drawnCohorts(
  cohorts: CohortSelector[],
  artifacts: DigestScan[],
  tags: Tag[],
  governance: GovernanceRecord[],
): CohortMeta[] {
  return cohorts.flatMap((selector) => {
    const identity = cohortIdentity(selector, artifacts, tags);
    if (identity === null) return [];
    const role = cohortRole(selector, artifacts, governance);
    return [role ? { selector, ...identity, role } : { selector, ...identity }];
  });
}

/**
 * Latest scan per repo, then sum each cohort. metric=share → fraction of the cohort total.
 * `componentCount` = distinct used identities (external deduped by id, local by repo+id)
 * unioned across the in-scope repos, so a
 * component present in N repos still contributes 1 if used in at least one. Occurrences
 * remain a plain appearance-sum across repos and are the headline metric. `names` holds
 * digests from other scans that only name a cohort and give it its role, never a value.
 */
export function projectCohortSnapshot(
  artifacts: DigestScan[],
  tags: Tag[],
  cohorts: CohortSelector[],
  metric: "count" | "share",
  governance: GovernanceRecord[] = [],
  names: DigestScan[] = [],
): CohortPoint[] {
  const latest = latestScanPerRepo(artifacts);

  const raw = drawnCohorts(cohorts, [...artifacts, ...names], tags, governance).map(({ selector, ...meta }) => {
    let occurrences = 0;
    const keys = new Set<string>();
    for (const a of latest) {
      const v = resolveCohort(selector, a, tags, governance);
      occurrences += v.occurrences;
      for (const k of v.usedKeys) keys.add(k);
    }
    return { ...meta, occurrences, componentCount: keys.size };
  });

  const total = raw.reduce((s, r) => s + r.occurrences, 0);
  return raw.map((r) => ({
    cohortKey: r.key,
    label: r.label,
    color: r.color,
    value: metric === "share" ? (total === 0 ? 0 : r.occurrences / total) : r.occurrences,
    componentCount: r.componentCount,
    ...(r.role ? { role: r.role } : {}),
  }));
}

/** Cohort occurrences over time. Step-union: each repo contributes its most-recent
 *  artifact as of each distinct timestamp. metric=share → fraction of cohort total at that point.
 *  Each cohort's series starts at the first scan of the earliest repo that has it in some scan.
 *  `names` only names a cohort and gives it its role, as in `projectCohortSnapshot`. */
export function projectCohortSeries(
  artifacts: DigestScan[],
  tags: Tag[],
  cohorts: CohortSelector[],
  metric: "count" | "share",
  governance: GovernanceRecord[] = [],
  names: DigestScan[] = [],
): CohortSeries[] {
  return projectSeries(
    artifacts,
    drawnCohorts(cohorts, [...artifacts, ...names], tags, governance).map(({ selector, ...meta }) => ({
      ...meta,
      occurrences: (a: DigestScan) => resolveCohort(selector, a, tags, governance).occurrences,
    })),
    metric,
    { fromFirstRepo: true },
  );
}

/** How many repos have a scan at each of a series' timestamps, out of the `total` repos in scope, and those repos' ids. */
export type RepoCoverage = { total: number; repoIds: string[]; points: Array<{ t: string; repos: number }> };

/** The timestamps a series projection draws a point at: each scan's `scanOrderTime`, oldest first. */
function seriesTimestamps(artifacts: DigestScan[]): string[] {
  return [...new Set(artifacts.map((a) => scanOrderTime(a.meta)))].sort((x, y) => x.localeCompare(y));
}

/** The repo coverage behind `projectSeries` over the same scans: a repo counts from its first scan on. */
export function projectRepoCoverage(artifacts: DigestScan[]): RepoCoverage {
  const firstByRepo = new Map<string, string>();
  for (const a of artifacts) {
    const t = scanOrderTime(a.meta);
    const first = firstByRepo.get(a.meta.repo.id);
    if (first === undefined || t.localeCompare(first) < 0) firstByRepo.set(a.meta.repo.id, t);
  }
  const firsts = [...firstByRepo.values()];
  return {
    total: firsts.length,
    repoIds: [...firstByRepo.keys()].sort(),
    points: seriesTimestamps(artifacts).map((t) => ({ t, repos: firsts.filter((first) => first.localeCompare(t) <= 0).length })),
  };
}

/** A series cohort: its display fields, and how many occurrences it has in one scan. */
export type SeriesCohort = { key: string; label: string; color: string; role?: CohortRole; packageName?: string; occurrences: (scan: DigestScan) => number };

/**
 * The step-union series projection behind `projectCohortSeries`, over cohorts that count their own occurrences per scan.
 * Each scan joins the timeline at its `scanOrderTime`. A point after a series' first names in `added` the repos whose
 * first scan it is and that have the cohort in that scan. With `fromFirstRepo`, a cohort's series starts at the first
 * scan of the earliest repo that has it in some scan.
 */
export function projectSeries(
  artifacts: DigestScan[],
  cohorts: SeriesCohort[],
  metric: "count" | "share",
  { fromFirstRepo = false }: { fromFirstRepo?: boolean } = {},
): CohortSeries[] {
  const byRepo = new Map<string, DigestScan[]>();
  for (const a of artifacts) {
    const arr = byRepo.get(a.meta.repo.id) ?? [];
    arr.push(a);
    byRepo.set(a.meta.repo.id, arr);
  }
  for (const arr of byRepo.values()) arr.sort((x, y) => newestScanFirst(y.meta, x.meta));

  const timestamps = seriesTimestamps(artifacts);

  // Consecutive timestamps share nearly the same as-of set (advancing one changes
  // at most the repo that produced it), so memoise per (scan, cohort index): within
  // one call the cohort at each index is fixed, so the count depends only on the scan.
  const occurrenceMemo = new Map<string, number>();
  const occurrencesFor = (ci: number, cohort: SeriesCohort, a: DigestScan): number => {
    const key = `${a.meta.scanId}\u0000${ci}`;
    const hit = occurrenceMemo.get(key);
    if (hit !== undefined) return hit;
    const value = cohort.occurrences(a);
    occurrenceMemo.set(key, value);
    return value;
  };

  // perTime[ti][ci] = occurrences for cohort ci at timestamp ti.
  const perTime: number[][] = timestamps.map((t) => {
    const asOf: DigestScan[] = [];
    for (const arr of byRepo.values()) {
      let latest: DigestScan | undefined;
      for (const a of arr) {
        if (scanOrderTime(a.meta).localeCompare(t) <= 0) latest = a;
        else break;
      }
      if (latest) asOf.push(latest);
    }
    return cohorts.map((cohort, ci) => asOf.reduce((s, a) => s + occurrencesFor(ci, cohort, a), 0));
  });

  const firstScans = [...byRepo.values()].flatMap(([first]) => (first ? [first] : []));
  return cohorts.map((cohort, ci) => {
    const holds = (a: DigestScan) => occurrencesFor(ci, cohort, a) > 0;
    const start = fromFirstRepo
      ? [...byRepo.values()].flatMap(([first, ...rest]) => (first && [first, ...rest].some(holds) ? [scanOrderTime(first.meta)] : [])).sort()[0]
      : undefined;
    return {
      cohortKey: cohort.key,
      label: cohort.label,
      color: cohort.color,
      ...(cohort.role ? { role: cohort.role } : {}),
      ...(cohort.packageName ? { packageName: cohort.packageName } : {}),
      points: timestamps.flatMap((t, ti) => {
        if (start !== undefined && t.localeCompare(start) < 0) return [];
        const row = perTime[ti]!;
        const occ = row[ci] ?? 0;
        const total = row.reduce((s, v) => s + v, 0);
        return [{ t, value: metric !== "share" ? occ : total === 0 ? 0 : occ / total }];
      }).map((point, i) => {
        const added = i === 0 ? [] : firstScans.filter((a) => scanOrderTime(a.meta) === point.t && holds(a)).map((a) => a.meta.repo.id).sort();
        return added.length > 0 ? { ...point, added } : point;
      }),
    };
  });
}

function matches(selector: CohortSelector, c: ComponentDigest, tags: Tag[], governance: GovernanceRecord[]): boolean {
  switch (selector.kind) {
    case "local":
      return presentIdentity(c).scope === "local";
    case "package": {
      // A package's exports, tags this scan resolves to it, and the repository declarations of its workspace package.
      if (presentIdentity(c).packageName !== selector.packageName) return false;
      return selector.deprecatedOnly ? componentDeprecated(c, governance) : true;
    }
    case "component":
      return c.id === selector.componentId;
    case "tag": {
      const tagged = resolveTags(presentIdentity(c).packageName, tags).some((t) => t.id === selector.tagId);
      if (!tagged) return false;
      return selector.deprecatedOnly ? componentDeprecated(c, governance) : true;
    }
    default: {
      const _exhaustive: never = selector;
      return _exhaustive;
    }
  }
}
