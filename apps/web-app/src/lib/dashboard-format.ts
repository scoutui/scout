/** Display formatting for cohort metric values, shared across the chart components. */

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

/**
 * The change since the previous scan, phrased as the previous level: "up from
 * 34.8% last scan" or "down from 900 last scan". The previous level needs no unit
 * of its own, where a signed share difference would need percentage points
 * ("+14.2%" would read as a relative change). The up or down word follows the
 * value, so colour is never the only signal; whether the move is good is
 * `deltaDirection`'s call, so a retirement going well reads "down from 900" in
 * green.
 *
 * A move under 0.05pp reads "±0 since last scan" (the same band as
 * `deltaDirection`, so the text can't contradict the colour). With fewer than
 * two scans it reads a bare em dash.
 *
 * `current` is the row's headline value: a migration's progress fraction (0..1,
 * delta in percentage points) or a retirement's remaining count (delta in
 * occurrences).
 */
export function formatDeltaFrom(
  kind: "migration" | "retirement",
  current: number | null,
  delta: number | null,
): string {
  if (delta === null || current === null) return "—";
  if (deltaDirection(kind, delta) === "none") return "±0 since last scan";
  const word = delta > 0 ? "up" : "down";
  const previous = kind === "migration" ? formatPct(current - delta / 100) : (current - delta).toLocaleString();
  return `${word} from ${previous} last scan`;
}

/**
 * Which way a governance-tracking change moved, by the record's declared intent.
 * The sign means opposite things by row kind: a migration's delta is progress in
 * percentage points (up is good), a retirement's is remaining occurrences (up is
 * bad).
 *
 * The migration band matches `formatDeltaFrom`'s ±0 in both directions, so a
 * colour can't contradict a rendered "±0". Counts have no band: one new call
 * site of a retired component is worth flagging.
 */
export function deltaDirection(
  kind: "migration" | "retirement",
  delta: number | null,
): "forward" | "backward" | "none" {
  if (delta === null) return "none";
  if (kind === "migration") {
    if (delta >= 0.05) return "forward";
    if (delta <= -0.05) return "backward";
    return "none";
  }
  if (delta < 0) return "forward";
  if (delta > 0) return "backward";
  return "none";
}

