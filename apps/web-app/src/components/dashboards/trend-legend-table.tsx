"use client";
import type { CohortSeries } from "@scoutui/web-shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortButton, ariaSort, sortRows, useSort } from "@/components/ui/sortable";
import { formatMetric } from "@/lib/dashboard-format";
import { cn } from "@/lib/utils";
import { CohortLabelText } from "@/components/dashboards/cohort-label";
import { CohortSwatch } from "@/components/dashboards/cohort-swatch";

type SortKey = "label" | "value";
const NUMERIC: ReadonlySet<SortKey> = new Set(["value"]);

/**
 * A trend chart's legend as a table: each series with its latest value, sortable by
 * either column, most first to start. Hovering a row highlights its line; clicking
 * its name shows only that line, and clicking it again shows every line.
 */
export function TrendLegendTable({
  series,
  colors,
  deprecatedOnly,
  metric,
  shown,
  onToggle,
  onHover,
}: {
  series: CohortSeries[];
  colors: ReadonlyMap<string, string>;
  deprecatedOnly: ReadonlySet<string>;
  metric: "count" | "share";
  shown: string | null;
  onToggle: (cohortKey: string) => void;
  onHover: (cohortKey: string | null) => void;
}) {
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("value", "desc", NUMERIC);
  const latest = series.map((s) => ({ ...s, value: s.points[s.points.length - 1]?.value ?? null }));
  const rows = sortRows(latest, sortKey, sortDir, (s, k) => (k === "label" ? s.label : s.value));

  return (
    <Table className="mt-3">
      <TableHeader>
        <TableRow>
          <TableHead aria-sort={ariaSort("label", sortKey, sortDir)}>
            <SortButton label="Name" sortKey="label" current={sortKey} dir={sortDir} onClick={toggleSort} />
          </TableHead>
          <TableHead className="text-right" aria-sort={ariaSort("value", sortKey, sortDir)}>
            <SortButton
              label={metric === "share" ? "% of uses" : "Uses"}
              sortKey="value"
              current={sortKey}
              dir={sortDir}
              onClick={toggleSort}
              align="right"
            />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => (
          <TableRow
            key={s.cohortKey}
            onMouseEnter={() => onHover(s.cohortKey)}
            onMouseLeave={() => onHover(null)}
            className={cn("transition-opacity duration-200", shown !== null && shown !== s.cohortKey && "opacity-40")}
          >
            <TableCell className="max-w-0 w-full">
              <button
                type="button"
                aria-pressed={shown === s.cohortKey}
                onClick={() => onToggle(s.cohortKey)}
                onFocus={() => onHover(s.cohortKey)}
                onBlur={() => onHover(null)}
                className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm text-left"
              >
                <CohortSwatch cohortKey={s.cohortKey} color={colors.get(s.cohortKey) ?? ""} role={s.role} />
                <CohortLabelText label={s.label} deprecatedOnly={deprecatedOnly.has(s.cohortKey)} className="text-xs" />
              </button>
            </TableCell>
            <TableCell className="text-right tabular-nums">{s.value === null ? "—" : formatMetric(s.value, metric)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
