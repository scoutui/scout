import type { ChartRange, DashboardConfig, DashboardView } from "@scoutui/web-shared";
import { barOrder, deprecatedOnlyKeys, expandRowShares, seriesToRows, visibleView } from "@/lib/dashboard-chart-data";
import { DEPRECATED_ONLY } from "@/lib/dashboard-format";

export type ExportTable = { columns: string[]; rows: string[][] };

/** A series' label as the chart shows it, followed by `deprecated only` for a deprecated-only cohort. */
export function exportLabel(cohort: { cohortKey: string; label: string }, deprecatedOnly: ReadonlySet<string>): string {
  return deprecatedOnly.has(cohort.cohortKey) ? `${cohort.label} · ${DEPRECATED_ONLY}` : cohort.label;
}

/**
 * The data a chart draws as a table: for a chart over time, one row per scan time inside `range` and one column per
 * series; for bars, one row per bar in the order the chart draws them.
 */
export function chartExportTable(config: DashboardConfig, view: DashboardView, range: ChartRange): ExportTable {
  const deprecatedOnly = deprecatedOnlyKeys(config.cohorts);
  const share = config.metric === "share" || config.chartType === "stacked-share";
  const cell = (value: number) => (share ? `${(value * 100).toFixed(1)}%` : String(value));
  if (view.kind === "snapshot") {
    return {
      columns: ["Series", share ? "Share" : "Uses"],
      rows: barOrder(view.points).map((p) => [exportLabel(p, deprecatedOnly), cell(p.value)]),
    };
  }
  const keys = view.series.map((s) => s.cohortKey);
  const { from } = visibleView(config, view, range);
  const rows = seriesToRows(view.series).filter(({ ts }) => from === null || Number(ts) >= from);
  const values = config.chartType === "stacked-share" ? expandRowShares(rows, keys) : rows;
  return {
    columns: ["Committed (UTC)", ...view.series.map((s) => exportLabel(s, deprecatedOnly))],
    rows: rows.map(({ ts, ...row }, i) => [
      new Date(Number(ts)).toISOString().slice(0, 16).replace("T", " "),
      ...keys.map((key) => (key in row ? cell(Number(values[i]?.[key])) : "")),
    ]),
  };
}

/**
 * The table as CSV: a field holding a comma, quote or line break is quoted, a field a spreadsheet would run as a
 * formula starts with `'`, and lines end in CRLF.
 */
export function toCsv(table: ExportTable): string {
  const field = (value: string) => {
    const safe = inert(value);
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return [table.columns, ...table.rows].map((row) => row.map(field).join(",")).join("\r\n");
}

/**
 * The table as tab-separated text, with each tab or line break inside a field turned into a space and a field a
 * spreadsheet would run as a formula starting with `'`.
 */
export function toTsv(table: ExportTable): string {
  const field = (value: string) => inert(value).replace(/\r\n|[\t\r\n]/g, " ");
  return [table.columns, ...table.rows].map((row) => row.map(field).join("\t")).join("\n");
}

const SCOPED_PACKAGE = /^@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*$/;

function inert(value: string): string {
  const formula = /^[=+\-\t\r]/.test(value) || (value.startsWith("@") && !SCOPED_PACKAGE.test(value));
  return formula ? `'${value}` : value;
}

/**
 * A file name for an export: the title with each slash as a space and the other characters file systems refuse
 * dropped, then `.ext`.
 */
export function exportFileName(title: string, ext: string): string {
  return `${title.replace(/[/\\]/g, " ").replace(/[:*?"<>|]/g, "").replace(/ {2,}/g, " ").trim()}.${ext}`;
}
