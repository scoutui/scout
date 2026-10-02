import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { GovernanceTracking } from "@scoutui/web-shared";
import { DashboardSparkline } from "@/components/dashboards/dashboard-sparkline";
import { LazyCohortTrendChart } from "@/components/dashboards/lazy-cohort-trend-chart";
import { chartColors, savedChartCohorts } from "@/lib/dashboard-chart-data";
import { deltaDirection, formatDeltaFrom, formatPct, } from "@/lib/dashboard-format";
import { cn } from "@/lib/utils";

const ROW_CAP = 5;

/** Row affordance: an inset outline, so the ring is never clipped by the panel's
 *  `overflow-hidden` the way a `ring-*` box-shadow would be. */
const ROW_FOCUS =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

/** Disclosure controls use a muted band with an always-visible chevron, so they
 *  can't be mistaken for tracking rows. */
const DISCLOSURE_BAND = `flex cursor-pointer list-none items-center gap-1.5 bg-muted px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground dark:hover:bg-accent [&::-webkit-details-marker]:hidden ${ROW_FOCUS}`;

/**
 * The shared summary for governance-tracking rows. An estate row links to the
 * chart's detail page; a repo row expands inline. Migration rows show the `from`
 * name, `to <successor>` beneath it, "N% migrated", the change in percentage
 * points and a small count trend of the pair. Retirement rows show the name,
 * "N remaining" in plain ink, the change in count and a small count trend in the
 * deprecated colour.
 *
 * The identifier is the only child that flexes, and below `xl` it takes its own
 * line and the sparkline is hidden: the fixed-width children add up to ~410px,
 * which would squeeze the name to zero width on a phone. The numbers move beside
 * the identifier only at `xl`, because below ~1100px the column left for the
 * identifier is too narrow.
 */
function TrackingSummary({ entry, uid, archived = false }: { entry: GovernanceTracking; uid: string; archived?: boolean }) {
  const migration = entry.kind === "migration";
  // Archived rows never show movement. Their numbers (remaining 0, progress 1)
  // already give direction "none", but the guard doesn't rely on that.
  const direction = archived ? "none" : deltaDirection(entry.kind, entry.delta);
  // Green marks a gain, so it follows the value, not the row kind: a stalled
  // migration and an archived row are plain ink, an unknown one is muted.
  const tone = archived
    ? "text-foreground"
    : !migration
      ? undefined // retirement counts are plain ink
      : entry.progress === null
        ? "text-muted-foreground" // no reading yet
        : entry.progress > 0
          ? "text-status-ok" // real progress
          : "text-foreground"; // 0%: not a gain

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 xl:flex-row xl:items-center xl:gap-4">
      {/* What is going away, then, for a migration, its successor on a quieter second
          line. Two lines at every width, so each half gets the full row width before
          it truncates. */}
      <div className="flex min-w-0 flex-col gap-0.5 font-mono text-sm xl:flex-1">
        <span className="truncate">{entry.fromLabel}</span>
        {entry.toLabel ? (
          <span className="truncate text-muted-foreground">
            <span className="font-sans text-xs">to</span> {entry.toLabel}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-3 xl:shrink-0 xl:gap-4">
        <span className="shrink-0 text-sm">
          {/* From `xl`, fixed width and right-aligned so the numbers line up as a
              column. Stacked below `xl`, they sit flush left. */}
          <span className={cn("font-medium tabular-nums xl:inline-block xl:w-16 xl:text-right", tone)}>
            {migration
              ? entry.progress !== null
                ? formatPct(entry.progress)
                : "—"
              : entry.remaining.toLocaleString()}
          </span>{" "}
          <span className="text-muted-foreground">
            {migration ? "migrated" : "remaining"}
          </span>
        </span>
        {/* The change since the last scan, coloured by the record's declared
            direction: green forward, red backward, muted for no change or unknown.
            The sign and font weight carry it too, not colour alone. */}
        <span
          className={cn(
            // w-40: "down from 34.8% last scan" is the widest endpoint phrase.
            "ml-auto shrink-0 text-right text-xs tabular-nums whitespace-nowrap xl:ml-0 xl:w-40",
            direction === "backward"
              ? "font-medium text-status-err"
              : direction === "forward"
                ? "font-medium text-status-ok"
                : "text-muted-foreground",
          )}
        >
          {archived
            ? "complete"
            : formatDeltaFrom(entry.kind, migration ? entry.progress : entry.remaining, entry.delta)}
        </span>
        <span className="hidden xl:block">
          <DashboardSparkline uid={uid} config={entry.config} view={{ kind: "series", series: entry.series }} />
        </span>
      </div>
    </div>
  );
}

function EstateRow({ entry, archived = false }: { entry: GovernanceTracking; archived?: boolean }) {
  return (
    <Link
      href={`/charts/${encodeURIComponent(entry.id)}`}
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary dark:hover:bg-accent",
        ROW_FOCUS,
      )}
    >
      <TrackingSummary entry={entry} uid={entry.id} archived={archived} />
    </Link>
  );
}

function RepoRow({ entry, defaultOpen }: { entry: GovernanceTracking; defaultOpen: boolean }) {
  return (
    <details open={defaultOpen} className="group">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary dark:hover:bg-accent [&::-webkit-details-marker]:hidden",
          ROW_FOCUS,
        )}
      >
        <TrackingSummary entry={entry} uid={`repo-${entry.id}`} />
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="border-t px-4 pb-4 pt-4">
        {/* Both kinds open onto counts over time: a migration is the
            deprecated + successor pair, a retirement the lone deprecated series. */}
        <LazyCohortTrendChart
          series={entry.series}
          colors={chartColors(savedChartCohorts(entry.config.cohorts, entry.series))}
          metric="count"
        />
      </div>
    </details>
  );
}

/**
 * A dense-row governance-tracking section. Callers pass active entries in
 * `entries`, most remaining first, and finished ones in `complete`. At most 5
 * active rows show; the rest, and the complete ones, sit behind native details
 * expanders, and the heading always carries the totals. Renders nothing when
 * both lists are empty.
 *
 * `preExpand` (repo surface only) opens rows on arrival. Callers set it when the
 * whole tab has exactly one tracking entry, not when one section happens to hold
 * one row.
 */
export function TrackingSection({
  kind,
  entries,
  complete = [],
  surface,
  preExpand = false,
}: {
  kind: "migration" | "retirement";
  entries: GovernanceTracking[];
  complete?: GovernanceTracking[];
  surface: "estate" | "repo";
  preExpand?: boolean;
}) {
  const completeCount = complete.length;
  if (entries.length === 0 && completeCount === 0) return null;
  const visible = entries.slice(0, ROW_CAP);
  const hidden = entries.slice(ROW_CAP);
  // The repo scope is named once in the heading rather than on every row, where
  // it would take ~95px from the identifier.
  const noun = kind === "migration" ? "Migrations" : "Retirements";
  const heading = [
    `${noun}${surface === "repo" ? " in this repo" : ""}`,
    entries.length > 0 ? `${entries.length.toLocaleString()} active` : null,
    completeCount > 0 ? `${completeCount.toLocaleString()} complete` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const row = (entry: GovernanceTracking) =>
    surface === "estate" ? (
      <EstateRow key={entry.id} entry={entry} />
    ) : (
      <RepoRow key={entry.id} entry={entry} defaultOpen={preExpand} />
    );

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm tabular-nums text-muted-foreground">{heading}</h2>
      <div className="panel divide-y divide-border overflow-hidden">
        {visible.map(row)}
        {hidden.length > 0 ? (
          <details className="group/expand">
            <summary className={DISCLOSURE_BAND}>
              <ChevronDown
                aria-hidden
                className="size-3.5 shrink-0 -rotate-90 transition-transform group-open/expand:rotate-0 motion-reduce:transition-none"
              />
              <span className="group-open/expand:hidden">Show all {entries.length.toLocaleString()} active</span>
              <span className="hidden group-open/expand:inline">Showing all {entries.length.toLocaleString()} active</span>
            </summary>
            <div className="divide-y divide-border border-t">{hidden.map(row)}</div>
          </details>
        ) : null}
        {completeCount > 0 ? (
          <details className="group/complete">
            <summary className={DISCLOSURE_BAND}>
              <ChevronDown
                aria-hidden
                className="size-3.5 shrink-0 -rotate-90 transition-transform group-open/complete:rotate-0 motion-reduce:transition-none"
              />
              <span className="group-open/complete:hidden">Show {completeCount.toLocaleString()} complete</span>
              <span className="hidden group-open/complete:inline">{completeCount.toLocaleString()} complete</span>
            </summary>
            <div className="divide-y divide-border border-t">
              {complete.map((entry) =>
                surface === "estate" ? (
                  <EstateRow key={entry.id} entry={entry} archived />
                ) : (
                  <RepoRow key={entry.id} entry={entry} defaultOpen={false} />
                ),
              )}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
