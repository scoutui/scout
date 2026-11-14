"use client";
import Link from "next/link";
import type { CohortSeries, ComponentRow, DiffMark, GovernanceTracking } from "@scoutui/web-shared";
import { CohortLabelText } from "@/components/dashboards/cohort-label";
import { TrackingReadout } from "@/components/dashboards/tracking-rows";
import type { PanelFactsState } from "@/components/repos/component-details-panel";
import { componentStory, type ComponentStory as Story } from "@/lib/component-story";
import { lineColors } from "@/lib/dashboard-chart-data";
import { formatDayTick } from "@/lib/dashboard-format";

const TITLE: Record<Story["kind"], string> = { migration: "Migration", retirement: "Retirement", uses: "Uses" };
const EMPTY: Record<NonNullable<Story["empty"]>, string> = {
  new: "New in this scan, so there's no history yet.",
  "one-scan": "Only one scan so far, so there's no history yet.",
};
const W = 400;
const PAD = 8;

/**
 * The selected component over time, in one story picked by its state: a migration's two counts with the chart page's
 * summary line, a retirement's uses left, or its uses in each scan of this repo. Each covers the three months to its
 * latest point, or every scan when fewer than two fall in them, and a migration or retirement opens its chart there.
 * On an older scan each ends at that scan, and a migration or retirement leaves out its summary, which is the latest
 * scan's.
 */
export function ComponentStory({ repoId, row, mark, entry, facts, olderScanAt, usedIn }: {
  repoId: string;
  row: ComponentRow;
  mark: DiffMark | undefined;
  /** The stored tracking entry that charts the row's governing record in this repo, if any. */
  entry: GovernanceTracking | null;
  facts: PanelFactsState;
  /** Where the shown scan sits in the repo's history when it isn't the latest; null on the latest. */
  olderScanAt: string | null;
  /** The Used in package the table is scoped to, if any; the story always counts the whole repo. */
  usedIn: string | null;
}) {
  const story = componentStory({ repoId, row, mark, entry, history: facts.state === "ready" ? facts.facts.history : null, olderScanAt });
  if (!story) {
    return facts.state === "loading" ? (
      <div aria-hidden className="space-y-2">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-16 rounded bg-muted" />
      </div>
    ) : null;
  }
  if (story.kind === "uses" && story.empty) return <p className="text-xs text-muted-foreground">{EMPTY[story.empty]}</p>;
  const names = story.series.map((s) => (s.role === "deprecated" && story.entry?.fromCount ? countLabel(story.entry.fromCount) : s.label));
  const span = story.range === "3m" ? "3 months" : "all scans";
  const colors = lineColors(story.series.map((s) => ({ cohortKey: s.cohortKey, color: s.color, role: s.role })));
  return (
    <section aria-labelledby="details-story" className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="details-story" className="text-label text-muted-foreground">
          {TITLE[story.kind]} · {span}
        </h3>
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
      {story.entry ? (olderScanAt === null ? <TrackingReadout entry={story.entry} /> : null) : <UsesLine series={story.series[0]} />}
      {usedIn ? (
        <p className="text-xs text-muted-foreground">
          Counts the whole repo, not just <span className="font-mono wrap-anywhere">{usedIn}</span>.
        </p>
      ) : null}
      {story.wholePackages.map((packageName) => (
        <p key={packageName} className="text-xs text-muted-foreground">
          Counts the whole <span className="font-mono wrap-anywhere">{packageName}</span> package.
        </p>
      ))}
      {story.components !== null ? <p className="text-xs text-muted-foreground">Counts the {story.components} components that share this replacement.</p> : null}
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
      {story.empty ? (
        <p className="text-xs text-muted-foreground">{EMPTY[story.empty]}</p>
      ) : (
        <StoryChart series={story.series} colors={colors} names={story.entry ? names : [`Uses of ${row.displayName}`]} />
      )}
    </section>
  );
}

/** "3 components · @acme/ui", as the chart page names a migration of more than two components. */
function countLabel({ components, packageName }: { components: number; packageName: string | null }): string {
  return `${components} components${packageName ? ` · ${packageName}` : ""}`;
}

/** "412 to 370 uses", or "370 uses, no change". */
function UsesLine({ series }: { series: CohortSeries | undefined }) {
  const from = series?.points[0]?.value ?? 0;
  const to = series?.points.at(-1)?.value ?? 0;
  const n = (value: number) => <span className="font-medium text-foreground">{value.toLocaleString()}</span>;
  return (
    <p className="text-sm tabular-nums text-muted-foreground">
      {from === to ? <>{n(to)} uses, no change</> : <>{n(from)} to {n(to)} uses</>}
    </p>
  );
}

/** The story's lines on one axis from 0, spaced by date, each ringed at its end, with the first and last day under it. */
function StoryChart({ series, colors, names }: { series: CohortSeries[]; colors: ReadonlyMap<string, string>; names: string[] }) {
  const H = series.length > 1 ? 64 : 56;
  const times = series.flatMap((s) => s.points.map((p) => Date.parse(p.t)));
  const first = Math.min(...times);
  const last = Math.max(...times);
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const x = (t: number) => (last === first ? W / 2 : PAD + ((t - first) / (last - first)) * (W - 2 * PAD));
  const y = (value: number) => H - 2 - (value / max) * (H - PAD - 2);
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
