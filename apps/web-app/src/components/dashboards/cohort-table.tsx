"use client";
import type { CohortPoint, CohortSeries, RepoCoverage } from "@scoutui/web-shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortButton, sortRows, useSort } from "@/components/ui/sortable";
import { formatMetric } from "@/lib/dashboard-format";
import { NO_KEYS, repoAddedAtLatest } from "@/lib/dashboard-chart-data";
import { CohortLabelText } from "@/components/dashboards/cohort-label";
import { CohortSwatch } from "@/components/dashboards/cohort-swatch";

type Key = "label" | "value" | "delta" | "componentCount";
const NUMERIC: ReadonlySet<Key> = new Set(["value", "delta", "componentCount"]);

/** True when a change reads as "0": none at all, or a share under 0.05 points. */
function isNoChange(delta: number, metric: "count" | "share"): boolean {
  return delta === 0 || (metric === "share" && Math.abs(delta) * 100 < 0.05);
}

/** Δ since the previous scan event, formatted per metric: counts as a signed number,
 *  shares as signed percentage points, "0" under 0.05 points. Null when there is no previous scan. */
function formatDelta(delta: number | null, metric: "count" | "share"): string {
  if (delta === null) return "—";
  const abs = Math.abs(delta);
  if (isNoChange(delta, metric)) return "0";
  const sign = delta > 0 ? "+" : "−";
  return metric === "share" ? `${sign}${(abs * 100).toFixed(1)} pts` : `${sign}${abs.toLocaleString()}`;
}

/**
 * Sortable cohort table: the name with its series colour, an inline bar
 * proportional to the largest cohort, the metric value, the change since the
 * previous scan in neutral ink (whether up is good depends on the cohort), and the
 * count of distinct used components across the cohort's repos (a component used in
 * N repos counts once).
 */
export function CohortTable({
  points,
  series,
  coverage,
  colors,
  deprecatedOnly = NO_KEYS,
  metric,
}: {
  points: CohortPoint[];
  series: CohortSeries[];
  coverage: RepoCoverage;
  colors: ReadonlyMap<string, string>;
  deprecatedOnly?: ReadonlySet<string>;
  metric: "count" | "share";
}) {
  const { sortKey, sortDir, toggleSort } = useSort<Key>("value", "desc", NUMERIC);

  const prevByKey = new Map(
    series.map((s) => [s.cohortKey, s.points.length >= 2 ? (s.points[s.points.length - 2]?.value ?? null) : null]),
  );
  const maxValue = Math.max(1, ...points.map((p) => p.value));
  const repoAdded = repoAddedAtLatest(coverage);
  const withDelta = points.map((p) => {
    const prev = prevByKey.get(p.cohortKey) ?? null;
    const delta = prev === null ? null : p.value - prev;
    return { ...p, seriesColor: colors.get(p.cohortKey) ?? "", delta, repoAdded: repoAdded && delta !== null && !isNoChange(delta, metric) };
  });
  const rows = sortRows(withDelta, sortKey, sortDir, (p, k) => (k === "delta" ? (p.repoAdded ? Number.NEGATIVE_INFINITY : (p.delta ?? Number.NEGATIVE_INFINITY)) : p[k]));
  const hasDelta = withDelta.some((p) => p.delta !== null);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <SortButton label="Name" sortKey="label" current={sortKey} dir={sortDir} onClick={toggleSort} />
          </TableHead>
          <TableHead aria-hidden className="w-[22%]" />
          <TableHead className="text-right">
            <SortButton
              label={metric === "share" ? "Share" : "Occurrences"}
              sortKey="value"
              current={sortKey}
              dir={sortDir}
              onClick={toggleSort}
              align="right"
            />
          </TableHead>
          {hasDelta ? (
            <TableHead className="text-right">
              <SortButton
                label="Change"
                title="Change since the previous scan"
                sortKey="delta"
                current={sortKey}
                dir={sortDir}
                onClick={toggleSort}
                align="right"
              />
            </TableHead>
          ) : null}
          <TableHead className="text-right">
            <SortButton
              label="Components"
              sortKey="componentCount"
              current={sortKey}
              dir={sortDir}
              onClick={toggleSort}
              align="right"
            />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.cohortKey}>
            <TableCell>
              <span className="inline-flex min-w-0 items-center gap-2">
                <CohortSwatch cohortKey={p.cohortKey} color={p.seriesColor} role={p.role} />
                <CohortLabelText label={p.label} deprecatedOnly={deprecatedOnly.has(p.cohortKey)} />
              </span>
            </TableCell>
            <TableCell>
              <div aria-hidden className="h-1.5 w-full max-w-[10rem] rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max((p.value / maxValue) * 100, p.value > 0 ? 2 : 0)}%`, backgroundColor: p.seriesColor }}
                />
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatMetric(p.value, metric)}</TableCell>
            {hasDelta ? (
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {p.repoAdded ? "repo added" : formatDelta(p.delta, metric)}
              </TableCell>
            ) : null}
            <TableCell className="text-right tabular-nums">{p.componentCount.toLocaleString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
