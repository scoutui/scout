/** Display formatting for cohort metric values, shared across the chart components. */
import type { CohortRole } from "@scoutui/web-shared";

/** User-facing words for the chart kinds. */
export const CHART_KIND_LABEL = { trend: "Trend", bars: "Bars", "stacked-share": "Stacked", table: "Table" } as const;

export const DEPRECATED_ONLY = "deprecated only";

/**
 * A fraction (0..1) as a one-decimal percentage. A tiny non-zero share reads
 * "<0.1%" rather than "0.0%", so a cohort that is present never looks absent.
 */
export function formatPct(value: number): string {
  if (value <= 0) return "0%";
  if (value < 0.001) return "<0.1%";
  return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

/** A cohort value formatted per its metric: counts get thousands separators, shares get a percentage. */
export function formatMetric(value: number, metric: "count" | "share"): string {
  return metric === "share" ? formatPct(value) : value.toLocaleString();
}

/** True when a change reads as "0": none at all, or a share under 0.05 points. */
function isNoChange(delta: number, metric: "count" | "share"): boolean {
  return delta === 0 || (metric === "share" && Math.abs(delta) * 100 < 0.05);
}

/** A change formatted per metric: counts as a signed number, shares as signed percentage points,
 *  "0" under 0.05 points, and "—" when there is nothing to compare. */
export function formatDelta(delta: number | null, metric: "count" | "share"): string {
  if (delta === null) return "—";
  const abs = Math.abs(delta);
  if (isNoChange(delta, metric)) return "0";
  const sign = delta > 0 ? "+" : "−";
  return metric === "share" ? `${sign}${(abs * 100).toFixed(1)} pts` : `${sign}${abs.toLocaleString()}`;
}

/**
 * Splits the label grammar `cohortLabel` derives, `name[ · package]`, so tight
 * chart space can drop the package segment first and keep the name.
 */
export function splitCohortLabel(label: string): { name: string; packageName?: string } {
  const parts = label.split(" · ");
  const name = parts[0] ?? label;
  if (parts.length === 1) return { name };
  const mid = parts.slice(1).join(" · ");
  return { name, ...(mid.length > 0 ? { packageName: mid } : {}) };
}

/**
 * For each series whose name another series shares, the part of its path that tells the group apart: comparing the
 * paths from the end, the first folders that differ, as many as it takes to tell every row apart. When the file names
 * differ, the file name, with its folder when some file in the group is an index file.
 */
export function distinctPaths(series: ReadonlyArray<{ cohortKey: string; label: string }>, paths: Readonly<Record<string, string>>): Map<string, string> {
  const groups = new Map<string, Array<{ key: string; path: string }>>();
  for (const s of series) {
    const path = paths[s.cohortKey];
    if (path !== undefined) groups.set(s.label, [...(groups.get(s.label) ?? []), { key: s.cohortKey, path }]);
  }
  const out = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const fromEnd = group.map(({ path }) => path.split("/").reverse());
    const longest = Math.max(...fromEnd.map((segments) => segments.length));
    const part = (from: number, to: number) => fromEnd.map((segments) => segments.slice(from, to + 1).reverse().join("/"));
    let from = 0;
    while (from < longest && new Set(part(from, from)).size === 1) from++;
    if (from === longest) continue;
    let to = from;
    while (to < longest - 1 && new Set(part(from, to)).size < group.length) to++;
    if (from === 0 && fromEnd.some(([file]) => file?.startsWith("index."))) to = Math.max(to, 1);
    const shown = part(from, to);
    for (const [i, { key }] of group.entries()) out.set(key, shown[i] ?? "");
  }
  return out;
}

/** How many series a chart or tooltip leaves unnamed. */
export function moreSeries(n: number): string {
  return `${n} more series`;
}

/** The package two or more cohort labels all name, or null when there's one label, one names none or two differ. */
export function sharedPackage(labels: readonly string[]): string | null {
  const packages = new Set(labels.map((label) => splitCohortLabel(label).packageName));
  const [only] = packages;
  return labels.length > 1 && packages.size === 1 && only !== undefined ? only : null;
}

/**
 * The distinctive part of a cohort label for tight chart space (end-of-line
 * labels): a package's last path segment (not the shared "@scope/" prefix) or a
 * component's display name (not its "· package" tail), capped so a long name
 * doesn't run off the plot. The legend and tooltip show the full label.
 */
const MAX_DISTINCTIVE = 20;
export function distinctiveLabel(label: string): string {
  const { name } = splitCohortLabel(label);
  const seg = name.includes("/") ? (name.split("/").pop() ?? name) : name;
  return seg.length > MAX_DISTINCTIVE ? `${seg.slice(0, MAX_DISTINCTIVE - 1)}…` : seg;
}

/**
 * A bars chart row's two lines: the distinctive name, and beneath it the
 * attribution (a component's package, or a scoped package's scope), so the two
 * lines together carry the full identity. An unscoped package, a tag and the
 * local cohort have no attribution line.
 */
export function barRowLabel(label: string): { name: string; attribution?: string } {
  const { name, packageName } = splitCohortLabel(label);
  const scope = name.startsWith("@") && name.includes("/") ? name.slice(0, name.indexOf("/")) : undefined;
  const attribution = packageName ?? scope;
  return { name: distinctiveLabel(label), ...(attribution ? { attribution } : {}) };
}

// Formats from the raw ISO string, not toLocaleString: the locale differs between
// server and client and breaks hydration.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export function formatDay(t: string): string {
  const m = Number(t.slice(5, 7));
  const d = Number(t.slice(8, 10));
  const month = MONTHS[m - 1];
  return month ? `${d} ${month}` : t.slice(0, 10);
}

/** Day label ("13 Jul") for a numeric epoch-ms axis tick, in UTC. */
export function formatDayTick(ts: number): string {
  return formatDay(new Date(ts).toISOString());
}

/** Tooltip stamp for a numeric x value: "2026-07-13 · 09:05", in UTC. */
export function formatScanStamp(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16).replace("T", " · ");
}

/** Compact, locale-independent axis numbers: 850 · 1.2k · 24k. */
export function formatAxisCount(v: number): string {
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(v);
}

/** A change in what is left: "6 fewer", "2 more", "no change", or an em dash with no reading. */
export function formatChange(delta: number | null): string {
  if (delta === null) return "—";
  if (delta === 0) return "no change";
  return `${Math.abs(delta).toLocaleString()} ${delta < 0 ? "fewer" : "more"}`;
}

/** "1 repo added" or "3 repos added"; null when none were. */
export function formatReposAdded(count: number): string | null {
  if (count === 0) return null;
  return `${count.toLocaleString()} ${count === 1 ? "repo" : "repos"} added`;
}

/** Which way a change in what is left moved: fewer is forward, more is backward. */
export function deltaDirection(delta: number | null): "forward" | "backward" | "none" {
  if (delta === null || delta === 0) return "none";
  return delta < 0 ? "forward" : "backward";
}

/** Which way a series' change moved it for its role: an old component's uses going down, or its replacement's going
 *  up, is forward. None for a change that reads "0", and for a series with no role, since nothing says whether up is
 *  good. */
export function seriesChangeDirection(delta: number | null, role: CohortRole | undefined, metric: "count" | "share"): "forward" | "backward" | "none" {
  if (delta === null || role === undefined || isNoChange(delta, metric)) return "none";
  return deltaDirection(role === "successor" ? -delta : delta);
}
