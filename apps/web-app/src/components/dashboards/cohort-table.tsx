"use client";
import type { CohortPoint } from "@scoutui/web-shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortButton, ariaSort, sortRows, useSort } from "@/components/ui/sortable";
import { formatDelta, formatMetric } from "@/lib/dashboard-format";
import { NO_KEYS } from "@/lib/dashboard-chart-data";
import { cn } from "@/lib/utils";
import { CohortLabelText } from "@/components/dashboards/cohort-label";
import { CohortSwatch } from "@/components/dashboards/cohort-swatch";
import { ADDED_SCROLL, type AddedRows } from "@/components/dashboards/trend-legend-table";

type Key = "label" | "value" | "delta" | "componentCount";
const NUMERIC: ReadonlySet<Key> = new Set(["value", "delta", "componentCount"]);

/** A cohort's row: its point, or with null values a series the chart doesn't draw. */
type Row = Omit<CohortPoint, "value" | "componentCount"> & { value: number | null; componentCount: number | null };

/**
 * Sortable cohort table: the name with its series colour, an inline bar
 * proportional to the largest cohort, the metric value, its `change` in neutral
 * ink (whether up is good depends on the cohort), and the count of distinct used
 * components across the cohort's repos (a component used in N repos counts once).
 * A row with no value reads "—". With `added`, the rows start in the order given
 * with no column sorted, each row ends with the actions `added` gives it, and the
 * table scrolls on its own as ADDED_SCROLL says.
 */
export function CohortTable({
  points,
  change,
  colors,
  deprecatedOnly = NO_KEYS,
  metric,
  added,
}: {
  points: Row[];
  change: Record<string, number | null>;
  colors: ReadonlyMap<string, string>;
  deprecatedOnly?: ReadonlySet<string>;
  metric: "count" | "share";
  added?: AddedRows | undefined;
}) {
  const { sortKey, sortDir, toggleSort } = useSort<Key, Key | null>(added ? null : "value", "desc", NUMERIC);

  const maxValue = Math.max(1, ...points.map((p) => p.value ?? 0));
  const withDelta = points.map((p) => ({ ...p, seriesColor: colors.get(p.cohortKey) ?? "", delta: change[p.cohortKey] ?? null }));
  const rows = sortKey === null ? withDelta : sortRows(withDelta, sortKey, sortDir, (p, k) => (k === "delta" ? (p.delta ?? Number.NEGATIVE_INFINITY) : p[k]));
  const hasDelta = withDelta.some((p) => p.delta !== null);

  return (
    <Table containerClassName={cn(added && ADDED_SCROLL)}>
      <TableHeader className={added ? "sticky top-0 z-10" : undefined}>
        <TableRow>
          <TableHead aria-sort={ariaSort("label", sortKey, sortDir)}>
            <SortButton label="Name" sortKey="label" current={sortKey} dir={sortDir} onClick={toggleSort} />
          </TableHead>
          <TableHead aria-hidden className="w-[22%]" />
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
          {hasDelta ? (
            <TableHead className="text-right" aria-sort={ariaSort("delta", sortKey, sortDir)}>
              <SortButton
                label="Change"
                title="Change over the last 30 days"
                sortKey="delta"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
                align="right"
              />
            </TableHead>
          ) : null}
          <TableHead className="text-right" aria-sort={ariaSort("componentCount", sortKey, sortDir)}>
            <SortButton
              label="Components"
              sortKey="componentCount"
              current={sortKey}
              dir={sortDir}
              onClick={toggleSort}
              align="right"
            />
          </TableHead>
          {added ? (
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => {
          const extra = added?.(p.cohortKey);
          const label = <CohortLabelText label={p.label} deprecatedOnly={deprecatedOnly.has(p.cohortKey)} className={cn(extra?.muted && "font-sans text-muted-foreground")} />;
          return (
            <TableRow key={p.cohortKey}>
              <TableCell>
                <span className="inline-flex min-w-0 items-center gap-2">
                  <CohortSwatch cohortKey={p.cohortKey} color={p.seriesColor} role={p.role} />
                  {extra?.note ? (
                    <span className="flex min-w-0 flex-col">
                      {label}
                      {extra.note}
                    </span>
                  ) : (
                    label
                  )}
                </span>
              </TableCell>
              <TableCell>
                <div aria-hidden className="h-1.5 w-full max-w-[10rem] rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${p.value === null ? 0 : Math.max((p.value / maxValue) * 100, p.value > 0 ? 2 : 0)}%`, backgroundColor: p.seriesColor }}
                  />
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{p.value === null ? "—" : formatMetric(p.value, metric)}</TableCell>
              {hasDelta ? (
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatDelta(p.delta, metric)}
                </TableCell>
              ) : null}
              <TableCell className="text-right tabular-nums">{p.componentCount === null ? "—" : p.componentCount.toLocaleString()}</TableCell>
              {extra ? <TableCell className="w-px py-0 whitespace-nowrap">{extra.actions}</TableCell> : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
