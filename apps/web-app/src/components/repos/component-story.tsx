"use client";
import { Info } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CohortSeries, ComponentRow, DiffMark, GovernanceTracking } from "@scoutui/web-shared";
import { plural } from "@scoutui/web-shared/client";
import { CohortLabelText } from "@/components/dashboards/cohort-label";
import { TrackingReadout } from "@/components/dashboards/tracking-rows";
import type { PanelFactsState } from "@/components/repos/component-details-panel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { componentStory, type StoryRange, type ComponentStory as Story } from "@/lib/component-story";
import { lineColors } from "@/lib/dashboard-chart-data";
import { formatDayTick } from "@/lib/dashboard-format";
import { deltaOf, deltaTone, signedCount } from "@/lib/scan-diff-view";
import { cn } from "@/lib/utils";

const TITLE: Record<Story["kind"], string> = { migration: "Migration", retirement: "Retirement", uses: "Uses" };
const EMPTY: Record<NonNullable<Story["empty"]>, string> = {
  new: "New in this scan, so there's no history yet.",
  "one-scan": "Only one scan so far, so there's no history yet.",
};
const FILL_IN_GUIDE = "https://scoutui.dev/docs/guides/fill-in-a-repos-history";
/** The note inside a uses story's frame when it has one point. */
const FIRST_POINT: Record<NonNullable<Story["empty"]>, ReactNode> = {
  new: "New in this scan, so its history starts here.",
  "one-scan": (
    <>
      History starts with the next scan.{" "}
      <a href={FILL_IN_GUIDE} className="rounded-sm text-foreground underline decoration-border underline-offset-3 hover:decoration-current">
        Fill in past scans
      </a>
    </>
  ),
};
const WINDOW: Record<StoryRange, string> = { "3m": "in 3 months", all: "across all scans" };
const W = 400;
const PAD = 8;
/** The chart's height in viewBox units for `lines` lines. */
const heightOf = (lines: number) => (lines > 1 ? 64 : 56);
/** The chart's y for a value, on one axis from 0 at the bottom to `max` near the top of a chart `h` high. */
const scaleY = (h: number, max: number) => (value: number) => h - 2 - (value / max) * (h - PAD - 2);

/**
 * The selected component over time, in one story picked by its state: a migration's two counts with the chart page's
 * summary line, a retirement's uses left, or its uses in each scan of this repo. Each covers the three months to its
 * latest point, or every scan when fewer than two fall in them, and a migration or retirement opens its chart there.
 * On an older scan each ends at that scan, and a migration or retirement leaves out its summary, which is the latest
 * scan's. While a uses story's facts load, the last one shown stays faded, or with none, its place is held.
 */
export function ComponentStory({ repoId, row, mark, showChange, entry, facts, olderScanAt, usedIn }: {
  repoId: string;
  row: ComponentRow;
  mark: DiffMark | undefined;
  /** Says the row's change since the previous scan, from `mark`, after a uses story's summary. */
  showChange: boolean;
  /** The stored tracking entry that charts the row's governing record in this repo, if any. */
  entry: GovernanceTracking | null;
  facts: PanelFactsState;
  /** Where the shown scan sits in the repo's history when it isn't the latest; null on the latest. */
  olderScanAt: string | null;
  /** The Used in package the table is scoped to, if any; the story always counts the whole repo. */
  usedIn: string | null;
}) {
  /** While the next component's facts load, the last facts shown, whose uses story stays faded until they land. */
  const previous = entry === null && facts.state === "loading" && facts.previous?.state === "ready" ? facts.previous.facts : null;
  const history = facts.state === "ready" ? facts.facts.history : (previous?.history ?? null);
  const story = componentStory({ repoId, row, mark: previous ? undefined : mark, entry, history, olderScanAt });
  if (!story) return facts.state === "loading" ? <StoryPlaceholder slow={facts.slow} /> : null;
  const change = !previous && showChange && story.empty === null ? deltaOf(mark, row.occurrenceCount) : 0;
  const usesName = previous ? "Uses" : `Uses of ${row.displayName}`;
  const names = story.series.map((s) => (s.role === "deprecated" && story.entry?.fromCount ? countLabel(story.entry.fromCount) : s.label));
  const span = story.range === "3m" ? "3 months" : "all scans";
  const colors = lineColors(story.series.map((s) => ({ cohortKey: s.cohortKey, color: s.color, role: s.role })));
  const section = (
    <section aria-labelledby="details-story" className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <h3 id="details-story" className="text-label text-muted-foreground">
            {TITLE[story.kind]} · {span}
          </h3>
          {usedIn || story.wholePackages.length > 0 || story.components !== null ? (
            <HowCounted>
              {usedIn ? (
                <p>
                  Counts the whole repo, not just <span className="font-mono wrap-anywhere">{usedIn}</span>.
                </p>
              ) : null}
              {story.wholePackages.map((packageName) => (
                <p key={packageName}>
                  Counts the whole <span className="font-mono wrap-anywhere">{packageName}</span> package.
                </p>
              ))}
              {story.components !== null ? <p>Counts the {story.components} components that share this replacement.</p> : null}
            </HowCounted>
          ) : null}
        </div>
        {story.href ? (
          <Link
            href={story.href}
            title={`Opens the ${story.kind} chart for this repo ${story.range === "3m" ? "at 3 months" : "with every scan"}`}
            className="shrink-0 rounded-sm text-xs underline decoration-border underline-offset-3 hover:decoration-current"
          >
            Open chart
          </Link>
        ) : null}
      </div>
      {story.entry ? (
        olderScanAt === null ? <TrackingReadout entry={story.entry} /> : null
      ) : (
        <UsesLine series={story.series[0]} range={story.range} empty={story.empty !== null} change={change} deprecated={row.deprecated} />
      )}
      {story.entry ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {story.series.map((s, i) => (
            <li key={s.cohortKey} className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
              <span aria-hidden className="h-0.75 w-3 shrink-0 self-center rounded-full" style={{ background: colors.get(s.cohortKey) }} />
              <CohortLabelText label={names[i] ?? s.label} className="text-foreground" />
              <span className="font-medium tabular-nums text-foreground">{(s.points.at(-1)?.value ?? 0).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {story.empty === null ? (
        <StoryChart series={story.series} colors={colors} names={story.entry ? names : [usesName]} />
      ) : story.entry ? (
        <p className="text-xs text-muted-foreground">{EMPTY[story.empty]}</p>
      ) : (
        <FirstPointChart series={story.series[0]} colors={colors} name={usesName} note={previous ? null : FIRST_POINT[story.empty]} />
      )}
    </section>
  );
  return previous ? (
    <div aria-busy="true" className="opacity-60">
      {section}
    </div>
  ) : (
    section
  );
}

/** Holds a uses story's space while its facts load: unseen at first, then a skeleton once the read is slow. */
function StoryPlaceholder({ slow }: { slow: boolean }) {
  return (
    <div aria-hidden className={cn("space-y-1.5", !slow && "invisible")}>
      <div className="h-[0.825rem] w-24 rounded bg-muted" />
      <div className="h-5 w-44 rounded bg-muted" />
      <div className="pb-4.5">
        <div className="rounded bg-muted" style={{ aspectRatio: `${W} / ${heightOf(1)}` }} />
      </div>
    </div>
  );
}

/**
 * An info button that shows how the story's counts are taken. Hover, keyboard focus or a press opens the note; a second
 * press keeps it open, and Esc, a press outside or moving focus away closes it.
 */
function HowCounted({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  /** Set when Esc closes the note, and cleared when the button loses focus or the pointer. While set, focusing the button doesn't open the note. */
  const escaped = useRef(false);
  useEffect(() => {
    if (!open) return;
    /** Closes the note on Esc before anything else on the page sees the key. */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      escaped.current = true;
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        if (!next && details.reason === "trigger-press") return details.cancel();
        setOpen(next);
      }}
    >
      <PopoverTrigger
        openOnHover
        aria-label="How this is counted"
        aria-haspopup="false"
        onFocus={(event) => {
          if (!escaped.current && event.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={() => {
          escaped.current = false;
        }}
        onMouseLeave={() => {
          escaped.current = false;
        }}
        className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors after:absolute after:-inset-1 hover:text-foreground aria-expanded:text-foreground"
      >
        <Info aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent role="tooltip" initialFocus={false} align="start" className="w-auto max-w-64 gap-1 px-2.5 py-2 text-xs">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** "3 components · @acme/ui", as the chart page names a migration of more than two components. */
function countLabel({ components, packageName }: { components: number; packageName: string | null }): string {
  return `${components} components${packageName ? ` · ${packageName}` : ""}`;
}

/**
 * "412 to 370 uses in 3 months", "370 uses, no change in 3 months", or with one point, "370 uses in this scan", then
 * " · −4 since previous scan" for a `change` other than 0, in `deltaTone`'s ink.
 */
function UsesLine({ series, range, empty, change, deprecated }: {
  series: CohortSeries | undefined;
  range: StoryRange;
  empty: boolean;
  change: number;
  deprecated: boolean;
}) {
  const from = series?.points[0]?.value ?? 0;
  const to = series?.points.at(-1)?.value ?? 0;
  const uses = plural(to, "use");
  const [count, rest] = empty ? [uses, " in this scan"] : from === to ? [uses, `, no change ${WINDOW[range]}`] : [`${from.toLocaleString()} to ${uses}`, ` ${WINDOW[range]}`];
  return (
    <p className="text-sm tabular-nums text-muted-foreground">
      <span className="font-medium text-foreground">{count}</span>
      {rest}
      {change !== 0 ? (
        <>
          {" · "}
          <span className={cn("font-medium", deltaTone(change, deprecated))}>{signedCount(change)}</span>
          {" since previous scan"}
        </>
      ) : null}
    </p>
  );
}

/** The story's lines on one axis from 0, spaced by date, each ringed at its end, with the first and last day under it. */
function StoryChart({ series, colors, names }: { series: CohortSeries[]; colors: ReadonlyMap<string, string>; names: string[] }) {
  const H = heightOf(series.length);
  const times = series.flatMap((s) => s.points.map((p) => Date.parse(p.t)));
  const first = Math.min(...times);
  const last = Math.max(...times);
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const x = (t: number) => (last === first ? W / 2 : PAD + ((t - first) / (last - first)) * (W - 2 * PAD));
  const y = scaleY(H, max);
  const label = series
    .map((s, i) => `${names[i] ?? s.label}: ${(s.points[0]?.value ?? 0).toLocaleString()} on ${formatDayTick(first)}, ${(s.points.at(-1)?.value ?? 0).toLocaleString()} on ${formatDayTick(last)}`)
    .join(". ")
    .concat(".");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block h-auto w-full overflow-visible">
        <line x1={PAD} x2={W - PAD} y1={y(max)} y2={y(max)} stroke="var(--border)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
        {series.map((s) => {
          const end = s.points.at(-1);
          const stroke = colors.get(s.cohortKey);
          return (
            <g key={s.cohortKey}>
              <polyline
                points={s.points.map((p) => `${x(Date.parse(p.t)).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")}
                fill="none"
                stroke={stroke}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {end ? <circle cx={x(Date.parse(end.t))} cy={y(end.value)} r={3.5} fill={stroke} stroke="var(--card)" strokeWidth={2} /> : null}
            </g>
          );
        })}
      </svg>
      <div aria-hidden className="mt-0.5 flex justify-between gap-2 text-xs tabular-nums text-muted-foreground">
        <span>{formatDayTick(first)}</span>
        <span>{formatDayTick(last)}</span>
      </div>
    </div>
  );
}

/**
 * A uses story's frame when it has one point: the axis, the point as a dot at the end on the chart's scale, with its
 * day under it, and any `note` inside the frame.
 */
function FirstPointChart({ series, colors, name, note }: { series: CohortSeries | undefined; colors: ReadonlyMap<string, string>; name: string; note: ReactNode }) {
  const point = series?.points.at(-1);
  const day = point ? formatDayTick(Date.parse(point.t)) : null;
  const H = heightOf(1);
  const y = scaleY(H, Math.max(1, point?.value ?? 0));
  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={point ? `${name}: ${point.value.toLocaleString()} on ${day}.` : `${name}.`}
          className="block h-auto w-full overflow-visible"
        >
          <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
          {series && point ? <circle cx={W - PAD} cy={y(point.value)} r={3.5} fill={colors.get(series.cohortKey)} stroke="var(--card)" strokeWidth={2} /> : null}
        </svg>
        <div className="absolute inset-0 flex items-center pe-10">
          <p className="text-xs text-muted-foreground">{note}</p>
        </div>
      </div>
      <div aria-hidden className="mt-0.5 flex h-4 justify-end text-xs tabular-nums text-muted-foreground">
        {day}
      </div>
    </div>
  );
}
