"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search, X } from "lucide-react";
import type { CohortSeries, DashboardConfig, GovernanceTracking } from "@scoutui/web-shared";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DashboardSparkline } from "@/components/dashboards/dashboard-sparkline";
import { deltaDirection, formatChange, formatPct, formatReposAdded } from "@/lib/dashboard-format";
import { cn } from "@/lib/utils";

const SEARCH_PAST = 10;
const GRID =
  "sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_5rem_7.5rem] sm:items-center sm:gap-x-4 xl:grid-cols-[minmax(0,1fr)_5rem_5rem_7.5rem_112px]";
const ROW = "focus-inset block px-4 py-2.5 transition-colors hover:bg-secondary dark:hover:bg-accent";
const PACKAGE_TREND: DashboardConfig = { scope: { kind: "all" }, cohorts: [], chartType: "trend", metric: "count" };

type Side = "progress" | "complete";
type Group = {
  packageName: string;
  entries: GovernanceTracking[];
  whole: GovernanceTracking | null;
  left: number;
  delta: number | null;
  trend: CohortSeries[];
};

/**
 * Every migration and retirement, grouped by the package it moves away from. Each package starts folded, and opening
 * it lists every entry in it. In progress and Complete switch between unfinished and finished entries, past 10
 * entries a search finds a component or package on the side showing, and while the page scrolls the column headings
 * and an open package's row stay under the top bar.
 */
export function TrackingList({ entries }: { entries: GovernanceTracking[] }) {
  const inProgress = entries.filter((entry) => entry.active);
  const complete = entries.filter((entry) => !entry.active);
  const [side, setSide] = useState<Side>(inProgress.length > 0 ? "progress" : "complete");
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const scrollTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    scrollTo.current?.scrollIntoView({ block: "start" });
    scrollTo.current = null;
  });
  if (entries.length === 0) return null;

  const q = query.trim().toLowerCase();
  const matching = (list: GovernanceTracking[]) => (q ? list.filter((entry) => matches(entry, q)) : list);
  const progressMatches = matching(inProgress);
  const completeMatches = matching(complete);
  const groups = groupByPackage(entries, side === "progress" ? progressMatches : completeMatches, side);
  const shown = side === "progress" ? progressMatches.length : completeMatches.length;
  const fold = (packageName: string, row: HTMLElement | null, group: HTMLElement | null) => {
    const key = `${side}:${packageName}`;
    if (opened.has(key) && row && group && group.getBoundingClientRect().top < row.getBoundingClientRect().top) scrollTo.current = row;
    setOpened((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  const count = (n: number) => <span className="tabular-nums text-muted-foreground">{n.toLocaleString()}</span>;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm text-muted-foreground">Migrations and retirements</h2>
      <div className="panel overflow-clip">
        {complete.length > 0 || entries.length > SEARCH_PAST ? (
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
            {complete.length > 0 ? (
              <ToggleGroup
                value={[side]}
                onValueChange={(value) => {
                  if (value[0] === "progress" || value[0] === "complete") setSide(value[0]);
                }}
                variant="outline"
                multiple={false}
                aria-label="Status"
              >
                <ToggleGroupItem value="progress">In progress {count(progressMatches.length)}</ToggleGroupItem>
                <ToggleGroupItem value="complete">Complete {count(completeMatches.length)}</ToggleGroupItem>
              </ToggleGroup>
            ) : null}
            {entries.length > SEARCH_PAST ? (
              <div className="relative min-w-0 max-w-md flex-1 basis-56">
                <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  aria-label="Find a component or package"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a component or package"
                  className="h-8 ps-8 font-mono text-base placeholder:font-sans sm:text-xs [&::-webkit-search-cancel-button]:hidden"
                />
                {query ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                    className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {side === "progress" && groups.length > 0 ? (
          <div className={cn(GRID, "pin-under-top-bar z-20 hidden h-9 border-b bg-muted px-4 text-label text-muted-foreground sm:grid")}>
            <span className="ps-6">Name</span>
            <span className="text-end">Migrated</span>
            <span className="text-end">Uses left</span>
            <span className="text-end" title="Change over the last 30 days">
              Change
            </span>
            <span className="hidden xl:block" />
          </div>
        ) : null}
        <div className="divide-y">
          {groups.map((group) =>
            group.whole ? (
              <EntryRow key={group.packageName} entry={group.whole} side={side} whole />
            ) : (
              <PackageGroup
                key={group.packageName}
                group={group}
                side={side}
                open={q !== "" || opened.has(`${side}:${group.packageName}`)}
                onFold={q === "" ? fold : null}
              />
            ),
          )}
        </div>
        {q && shown === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            Nothing matches <span className="font-mono">{query.trim()}</span>.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function PackageGroup({
  group,
  side,
  open,
  onFold,
}: {
  group: Group;
  side: Side;
  open: boolean;
  onFold: ((packageName: string, row: HTMLElement | null, group: HTMLElement | null) => void) | null;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const name = (
    <>
      <ChevronRight
        aria-hidden
        className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-90")}
      />
      <span className="font-mono text-sm font-medium wrap-anywhere">{group.packageName}</span>
    </>
  );
  return (
    <div ref={groupRef} data-slot="package">
      <div
        ref={rowRef}
        data-slot="package-row"
        className={cn(
          "pin-under-top-bar z-10 px-4 py-2.5",
          side === "progress" && cn(GRID, "sm:[--pin-below:2.25rem]"),
          open && "border-b bg-[color-mix(in_oklch,var(--muted)_40%,var(--card))]",
        )}
      >
        <div className="min-w-0">
          {onFold ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => onFold(group.packageName, rowRef.current, groupRef.current)}
              className="focus-inset -m-1 flex min-w-0 cursor-pointer items-start gap-1.5 rounded-sm p-1 text-start"
            >
              {name}
            </button>
          ) : (
            <div className="flex min-w-0 items-start gap-1.5">{name}</div>
          )}
          {side === "progress" ? (
            <div className="mt-1 flex flex-wrap gap-x-3 ps-5 text-xs tabular-nums text-muted-foreground sm:hidden">
              <span>
                <span className="font-medium text-foreground">{group.left.toLocaleString()}</span> left
              </span>
              <Change delta={group.delta} />
            </div>
          ) : null}
        </div>
        {side === "progress" ? (
          <>
            <span className="hidden sm:block" />
            <span className="hidden text-end text-sm font-medium tabular-nums sm:block">{group.left.toLocaleString()}</span>
            <span className="hidden text-end text-xs sm:block">
              <Change delta={group.delta} />
            </span>
            <span className="hidden xl:block">
              <DashboardSparkline
                uid={`package-${group.packageName}`}
                config={PACKAGE_TREND}
                view={{ kind: "series", series: group.trend, coverage: { total: 0, points: [] } }}
              />
            </span>
          </>
        ) : null}
      </div>
      {open ? (
        <div className="divide-y">
          {group.entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} side={side} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EntryRow({ entry, side, whole = false }: { entry: GovernanceTracking; side: Side; whole?: boolean }) {
  const href = `/charts/${encodeURIComponent(entry.id)}`;
  const names = (
    <div className={cn("min-w-0", whole ? "ps-5" : "ps-6")}>
      <div className={cn("font-mono text-sm wrap-anywhere", whole && "font-medium")}>{rowName(entry)}</div>
      <div className="mt-0.5 text-xs text-muted-foreground wrap-anywhere">
        {entry.toLabel ? (
          <>
            to <span className="font-mono text-sm">{entry.toLabel}</span>
          </>
        ) : (
          "Retired"
        )}
      </div>
    </div>
  );
  const sparkline = <DashboardSparkline uid={entry.id} config={entry.config} view={{ kind: "series", series: entry.series, coverage: entry.coverage }} />;
  if (side === "complete") {
    return (
      <Link href={href} className={cn(ROW, "flex items-center gap-4")}>
        <div className="min-w-0 flex-1">{names}</div>
        <span className="hidden sm:block">{sparkline}</span>
      </Link>
    );
  }
  const migrated = entry.kind === "migration" ? (entry.progress === null ? "—" : formatPct(entry.progress)) : null;
  const tone = entry.progress === null ? "text-muted-foreground" : entry.progress > 0 ? "text-status-ok" : undefined;
  const reposAdded = formatReposAdded(entry.reposAdded);
  return (
    <Link href={href} className={cn(ROW, GRID)}>
      <div className="min-w-0">
        {names}
        <div className={cn("mt-1 flex flex-wrap gap-x-3 text-xs tabular-nums text-muted-foreground sm:hidden", whole ? "ps-5" : "ps-6")}>
          {migrated ? (
            <span>
              <span className={cn("font-medium text-foreground", tone)}>{migrated}</span> migrated
            </span>
          ) : null}
          <span>
            <span className="font-medium text-foreground">{entry.remaining.toLocaleString()}</span> left
          </span>
          <Change delta={entry.delta} />
          {reposAdded ? <span>{reposAdded}</span> : null}
        </div>
      </div>
      <span className={cn("hidden text-end text-sm tabular-nums sm:block", tone)}>{migrated}</span>
      <span className="hidden text-end text-sm tabular-nums sm:block">{entry.remaining.toLocaleString()}</span>
      <span className="hidden text-end text-xs sm:block">
        <Change delta={entry.delta} />
        {reposAdded ? <span className="block text-muted-foreground">{reposAdded}</span> : null}
      </span>
      <span className="hidden xl:block">{sparkline}</span>
    </Link>
  );
}

function Change({ delta }: { delta: number | null }) {
  const direction = deltaDirection(delta);
  return (
    <span
      className={cn(
        "tabular-nums",
        direction === "backward" ? "font-medium text-status-err" : direction === "forward" ? "font-medium text-status-ok" : "text-muted-foreground",
      )}
    >
      {formatChange(delta)}
    </span>
  );
}

/** The components an entry covers, without their package when they share one. */
function rowName(entry: GovernanceTracking): string {
  const [first] = entry.from;
  if (!first || entry.from.some((rule) => rule.targetPackage !== first.targetPackage)) return entry.fromLabel;
  if (entry.from.some((rule) => rule.targetExport === null)) return first.targetPackage;
  return entry.from.map((rule) => rule.targetExport).join(", ");
}

function matches(entry: GovernanceTracking, q: string): boolean {
  return [entry.fromLabel, entry.toLabel ?? ""].some((text) => text.toLowerCase().includes(q));
}

/**
 * The packages with an entry in `shown`, each with those entries. A package's uses left, change and trend add up
 * every entry in it, finished ones too. A package one entry covers whole is that entry.
 */
function groupByPackage(all: GovernanceTracking[], shown: GovernanceTracking[], side: Side): Group[] {
  const byPackage = new Map<string, GovernanceTracking[]>();
  for (const entry of all) byPackage.set(entry.record.targetPackage, [...(byPackage.get(entry.record.targetPackage) ?? []), entry]);
  const byName = (a: GovernanceTracking, b: GovernanceTracking) => rowName(a).localeCompare(rowName(b));
  const groups: Group[] = [];
  for (const [packageName, members] of byPackage) {
    const entries = shown.filter((entry) => entry.record.targetPackage === packageName);
    if (entries.length === 0) continue;
    entries.sort(side === "progress" ? (a, b) => b.remaining - a.remaining || byName(a, b) : byName);
    const [only] = members;
    const deltas = members.flatMap((entry) => (entry.delta === null ? [] : [entry.delta]));
    groups.push({
      packageName,
      entries,
      whole: members.length === 1 && only && rowName(only) === packageName ? only : null,
      left: members.reduce((n, entry) => n + entry.remaining, 0),
      delta: deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) : null,
      trend: packageTrend(packageName, members),
    });
  }
  return groups.sort(
    side === "progress" ? (a, b) => b.left - a.left || a.packageName.localeCompare(b.packageName) : (a, b) => a.packageName.localeCompare(b.packageName),
  );
}

/** The entries' uses left added up at every point any of them has, each holding its last value until its next. */
function packageTrend(packageName: string, entries: GovernanceTracking[]): CohortSeries[] {
  const lines = entries.flatMap((entry) => entry.series.filter((series) => series.role === "deprecated"));
  const times = [...new Set(lines.flatMap((series) => series.points.map((point) => point.t)))].sort();
  const valueAt = (series: CohortSeries, t: string) => series.points.reduce((value, point) => (point.t <= t ? point.value : value), 0);
  return [
    {
      cohortKey: `package:${packageName}`,
      label: packageName,
      color: "",
      role: "deprecated",
      points: times.map((t) => ({ t, value: lines.reduce((n, series) => n + valueAt(series, t), 0) })),
    },
  ];
}
