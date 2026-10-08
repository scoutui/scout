"use client";
import { useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { CohortSeries } from "@scoutui/web-shared";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortButton, ariaSort, sortRows, useSort } from "@/components/ui/sortable";
import { searchedSeries } from "@/lib/dashboard-chart-data";
import { distinctPaths, formatDayTick, formatDelta, formatMetric, seriesChangeDirection } from "@/lib/dashboard-format";
import { cn } from "@/lib/utils";
import { CohortLabelText, SlashBreaks } from "@/components/dashboards/cohort-label";
import { CohortSwatch } from "@/components/dashboards/cohort-swatch";

type SortKey = "label" | "value" | "delta";
const NUMERIC: ReadonlySet<SortKey> = new Set(["value", "delta"]);

// Past this many series the table shows its first rows, with Show all and a search.
const FIRST_ROWS = 10;

/** Each series' change by `cohortKey`, since `since` in epoch ms. */
export type SeriesChange = { since: number; byKey: Readonly<Record<string, number | null>> };

/**
 * A trend chart's legend as a table: each series with its latest value, sortable by
 * either column, most first to start. Hovering a row highlights its line; clicking
 * its name shows only that line, and clicking it again shows every line. With `change`, a Change column shows each
 * series' change since the day it names, green where an old component went down or its replacement went up and red the
 * other way. With `paths`, a row whose name another row shares shows the part of its
 * component's path that tells the rows apart. Past FIRST_ROWS series the table
 * lists the first FIRST_ROWS rows in its sort, with a Show all button and a search, `query`, by component or package
 * name that lists every match. The row of a line shown on its own stays in the table whatever the search or Show all.
 * While the page scrolls, the column headings stay under the top bar.
 */
export function TrendLegendTable({
  series,
  colors,
  deprecatedOnly,
  metric,
  change,
  paths = {},
  query,
  onQueryChange,
  shown,
  onToggle,
  onHover,
}: {
  series: CohortSeries[];
  colors: ReadonlyMap<string, string>;
  deprecatedOnly: ReadonlySet<string>;
  metric: "count" | "share";
  change?: SeriesChange | undefined;
  paths?: Readonly<Record<string, string>> | undefined;
  query: string;
  onQueryChange: (query: string) => void;
  shown: string | null;
  onToggle: (cohortKey: string) => void;
  onHover: (cohortKey: string | null) => void;
}) {
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("value", "desc", NUMERIC);
  const [expanded, setExpanded] = useState(false);
  const latest = series.map((s) => ({ ...s, value: s.points[s.points.length - 1]?.value ?? null, delta: change?.byKey[s.cohortKey] ?? null }));
  const sorted = sortRows(latest, sortKey, sortDir, (s, k) => (k === "label" ? s.label : k === "delta" ? s.delta : s.value));
  const hasDelta = latest.some((s) => s.delta !== null);
  const changeHeading = change ? `Change since ${formatDayTick(change.since)}` : "";
  // A no-break space keeps the day and its month on one line when the heading wraps.
  const changeLabel = changeHeading.replace(/ (\S+)$/, "\u00a0$1");
  const shownPaths = distinctPaths(series, paths);
  const capped = series.length > FIRST_ROWS;
  const searching = query.trim() !== "";
  const matched = new Set(searchedSeries(series, query)?.map((s) => s.cohortKey));
  const rows = sorted.filter((s, i) =>
    s.cohortKey === shown || (searching ? matched.has(s.cohortKey) : !capped || expanded || i < FIRST_ROWS),
  );

  return (
    <div className="mt-3">
      {capped ? (
        <div className="relative mb-2 max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search series by component or package name"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={`Search ${series.length.toLocaleString()} series…`}
            className="h-8 pl-8 font-mono text-base placeholder:font-sans sm:text-xs [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQueryChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      <Table containerClassName="@container overflow-x-clip">
        <TableHeader className="pin-under-top-bar z-20">
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
            {hasDelta ? (
              <TableHead className="text-right @max-md:h-auto @max-md:py-1.5 @max-md:whitespace-normal @max-md:[&_span]:whitespace-normal" aria-sort={ariaSort("delta", sortKey, sortDir)}>
                <SortButton
                  label={changeLabel}
                  title={changeHeading}
                  sortKey="delta"
                  current={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                  align="right"
                />
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => {
            const path = shownPaths.get(s.cohortKey);
            const direction = seriesChangeDirection(s.delta, s.role, metric);
            return (
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
                    <span className="flex min-w-0 flex-col">
                      <CohortLabelText
                        label={s.label}
                        deprecatedOnly={deprecatedOnly.has(s.cohortKey)}
                        className="text-xs @max-md:flex-col @max-md:items-stretch @max-md:gap-0 @max-md:*:whitespace-normal @max-md:*:wrap-anywhere"
                      />
                      {path !== undefined ? (
                        <span className="font-mono text-xs whitespace-normal text-muted-foreground wrap-anywhere" title={paths[s.cohortKey]}>
                          <SlashBreaks text={path} />
                        </span>
                      ) : null}
                    </span>
                  </button>
                </TableCell>
                <TableCell className="text-right tabular-nums">{s.value === null ? "—" : formatMetric(s.value, metric)}</TableCell>
                {hasDelta ? (
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      direction === "backward" ? "font-medium text-status-err" : direction === "forward" ? "font-medium text-status-ok" : "text-muted-foreground",
                    )}
                  >
                    {formatDelta(s.delta, metric)}
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
          {searching && matched.size === 0 ? (
            <TableRow>
              <TableCell colSpan={hasDelta ? 3 : 2} className="py-6 text-center text-muted-foreground">
                No series match <span className="font-mono">{query.trim()}</span>.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
      {capped && !searching ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="mt-2 inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronDown aria-hidden className={cn("size-3.5 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
          {expanded ? "Show fewer" : `Show all ${series.length.toLocaleString()}`}
        </button>
      ) : null}
    </div>
  );
}
