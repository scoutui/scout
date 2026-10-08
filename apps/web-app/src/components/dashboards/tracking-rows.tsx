import { ChevronDown } from "lucide-react";
import type { GovernanceTracking } from "@scoutui/web-shared";
import { DashboardSparkline } from "@/components/dashboards/dashboard-sparkline";
import { LazyCohortTrendChart } from "@/components/dashboards/lazy-cohort-trend-chart";
import { chartColors, savedChartCohorts } from "@/lib/dashboard-chart-data";
import { deltaDirection, formatChange, formatPct, formatReposAdded } from "@/lib/dashboard-format";
import { cn } from "@/lib/utils";

const ROW_CAP = 5;

/** Disclosure controls use a muted band with an always-visible chevron, so they
 *  can't be mistaken for tracking rows. */
const DISCLOSURE_BAND = "flex cursor-pointer list-none items-center gap-1.5 bg-muted px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground dark:hover:bg-accent [&::-webkit-details-marker]:hidden focus-inset";

/**
 * The summary of a repo's governance-tracking row, which expands inline. Migration rows show the `from`
 * name, `to <successor>` beneath it, "N% migrated", "N left", the change in what
 * is left and a small count trend of the pair. Retirement rows show the name,
 * "N left" in plain ink, the change in what is left and a small count trend in
 * the deprecated colour.
 *
 * The identifier is the only child that flexes, and below `xl` it takes its own
 * line and the sparkline is hidden: the fixed-width children add up to ~410px,
 * which would squeeze the name to zero width on a phone. The numbers move beside
 * the identifier only at `xl`, because below ~1100px the column left for the
 * identifier is too narrow.
 */
function TrackingSummary({ entry, uid }: { entry: GovernanceTracking; uid: string }) {
  const migration = entry.kind === "migration";
  const direction = deltaDirection(entry.delta);
  const reposAdded = formatReposAdded(entry.reposAdded);
  // Green marks a gain, so it follows the value, not the row kind: a stalled
  // migration is plain ink, an unknown one is muted.
  const tone = !migration
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
          it wraps (below `sm`) or truncates. */}
      <div className="flex min-w-0 flex-col gap-0.5 font-mono text-sm xl:flex-1">
        <span className="wrap-anywhere sm:truncate">{entry.fromLabel}</span>
        {entry.toLabel ? (
          <span className="wrap-anywhere text-muted-foreground sm:truncate">
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
            {migration ? "migrated" : "left"}
          </span>
        </span>
        {migration ? (
          <span className="shrink-0 text-sm">
            <span className="tabular-nums xl:inline-block xl:w-14 xl:text-right">{entry.remaining.toLocaleString()}</span>{" "}
            <span className="text-muted-foreground">left</span>
          </span>
        ) : null}
        {/* Green for fewer left, red for more, muted for no change or unknown. The
            words and font weight carry it too, not colour alone. */}
        <span className="ml-auto shrink-0 text-right text-xs tabular-nums whitespace-nowrap xl:ml-0 xl:w-44">
          <span
            className={cn(
              direction === "backward"
                ? "font-medium text-status-err"
                : direction === "forward"
                  ? "font-medium text-status-ok"
                  : "text-muted-foreground",
            )}
          >
            {formatChange(entry.delta)}
          </span>
          {reposAdded ? <span className="text-muted-foreground"> · {reposAdded}</span> : null}
        </span>
        <span className="hidden xl:block">
          <DashboardSparkline uid={uid} config={entry.config} view={{ kind: "series", series: entry.series, coverage: entry.coverage }} />
        </span>
      </div>
    </div>
  );
}

/** A tracking entry's numbers on one line, for its chart page: "40% migrated · 24 left · 6 fewer in the last 30 days". */
export function TrackingReadout({ entry }: { entry: GovernanceTracking }) {
  const direction = deltaDirection(entry.delta);
  const reposAdded = formatReposAdded(entry.reposAdded);
  return (
    <p className="text-sm tabular-nums text-muted-foreground">
      {entry.kind === "migration" ? (
        <>
          <span className="font-medium text-foreground">{entry.progress === null ? "—" : formatPct(entry.progress)}</span> migrated ·{" "}
        </>
      ) : null}
      <span className="font-medium text-foreground">{entry.remaining.toLocaleString()}</span> left
      {entry.delta === null ? null : (
        <>
          {" · "}
          <span className={cn(direction === "backward" ? "font-medium text-status-err" : direction === "forward" ? "font-medium text-status-ok" : undefined)}>
            {formatChange(entry.delta)}
          </span>{" "}
          in the last 30 days
        </>
      )}
      {reposAdded ? ` · ${reposAdded}` : null}
    </p>
  );
}

function RepoRow({ entry, defaultOpen }: { entry: GovernanceTracking; defaultOpen: boolean }) {
  return (
    <details open={defaultOpen} className="group">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary dark:hover:bg-accent [&::-webkit-details-marker]:hidden",
          "focus-inset",
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
            deprecated + successor pair, a retirement the lone deprecated series.
            A migration with no use of the deprecated side in this repo has
            nothing to chart. */}
        {entry.coverage.total === 0 ? (
          <p className="text-sm text-muted-foreground">No scan of this repo has found a use of {entry.fromLabel}, so there's nothing to migrate.</p>
        ) : (
          <LazyCohortTrendChart
            series={entry.series}
            coverage={entry.coverage}
            colors={chartColors(savedChartCohorts(entry.config.cohorts, entry.series))}
            metric="count"
          />
        )}
      </div>
    </details>
  );
}

/**
 * A dense-row section of a repo's governance tracking. Callers pass active entries in
 * `entries`, most remaining first, and finished ones in `complete`. At most 5
 * active rows show; the rest, and the complete ones, sit behind native details
 * expanders, and the heading always carries the totals. Renders nothing when
 * both lists are empty.
 *
 * `preExpand` opens rows on arrival. Callers set it when the whole tab has exactly
 * one tracking entry, not when one section happens to hold one row.
 */
export function TrackingSection({
  kind,
  entries,
  complete = [],
  preExpand = false,
}: {
  kind: "migration" | "retirement";
  entries: GovernanceTracking[];
  complete?: GovernanceTracking[];
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
    `${noun} in this repo`,
    entries.length > 0 ? `${entries.length.toLocaleString()} in progress` : null,
    completeCount > 0 ? `${completeCount.toLocaleString()} complete` : null,
    entries.length > 0 ? "change over the last 30 days" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const row = (entry: GovernanceTracking) => <RepoRow key={entry.id} entry={entry} defaultOpen={preExpand} />;

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
              <span className="group-open/expand:hidden">Show all {entries.length.toLocaleString()} in progress</span>
              <span className="hidden group-open/expand:inline">Showing all {entries.length.toLocaleString()} in progress</span>
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
              {complete.map((entry) => (
                <RepoRow key={entry.id} entry={entry} defaultOpen={false} />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
