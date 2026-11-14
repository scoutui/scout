import type { CohortSeries, ComponentRow, DiffMark, GovernanceTracking } from "@scoutui/web-shared";
import { rangeStart } from "@scoutui/web-shared/client";
import type { HistoryPoint } from "@/lib/component-panel";
import { seriesFrom } from "@/lib/dashboard-chart-data";
import { derivedChartHref } from "@/lib/derived-dashboards";

/** The months a story covers: the charts' shortest range, or every scan when fewer than two fall in it. */
export type StoryRange = "3m" | "all";

/**
 * What the details panel tells about a component over time. A migration or retirement is the stored tracking entry
 * that charts the component's governing record, as the Adoption tab lists it and `href` opens it; `wholePackages`
 * names the packages it counts whole, and `components` is how many components it counts when its records name more
 * than one and no whole package. Otherwise it's the component's uses in each scan. `series` is what the panel
 * draws, and `empty` says why there's nothing to draw when the series have fewer than two points.
 */
export type ComponentStory = {
  kind: "migration" | "retirement" | "uses";
  entry: GovernanceTracking | null;
  series: CohortSeries[];
  range: StoryRange;
  href: string | null;
  wholePackages: string[];
  components: number | null;
  empty: "new" | "one-scan" | null;
};

/**
 * The series a story draws: from three months before the latest point, as the chart's 3-month range draws them, or
 * every point when fewer than two scans fall in those months.
 */
export function storyWindow(series: CohortSeries[]): { series: CohortSeries[]; range: StoryRange } {
  const start = rangeStart(series, "3m");
  if (start === null) return { series, range: "3m" };
  const inside = new Set(series.flatMap((s) => s.points.filter((p) => Date.parse(p.t) >= start).map((p) => p.t)));
  return inside.size < 2 ? { series, range: "all" } : { series: seriesFrom(series, start), range: "3m" };
}

/**
 * The story for `row`: its tracking `entry` when there is one, otherwise its `history` in this repo, or null while
 * that history is still loading. On an older scan, `olderScanAt` is where that scan sits in the repo's history, and
 * the entry's series end there; its chart link stays the latest scan's.
 */
export function componentStory({ repoId, row, mark, entry, history, olderScanAt }: {
  repoId: string;
  row: ComponentRow;
  mark: DiffMark | undefined;
  entry: GovernanceTracking | null;
  history: HistoryPoint[] | null;
  olderScanAt: string | null;
}): ComponentStory | null {
  const empty = (series: CohortSeries[]) =>
    Math.max(0, ...series.map((s) => s.points.length)) >= 2 ? null : mark?.kind === "added" ? "new" : "one-scan";
  if (entry) {
    const end = olderScanAt === null ? Number.POSITIVE_INFINITY : Date.parse(olderScanAt);
    const { series, range } = storyWindow(entry.series.map((s) => ({ ...s, points: s.points.filter((p) => Date.parse(p.t) <= end) })));
    const wholePackages = entry.from.flatMap((rule) => (rule.grain === "package" ? [rule.targetPackage] : []));
    return {
      kind: entry.kind,
      entry,
      series,
      range,
      href: derivedChartHref(entry.id, { kind: "repo", repoId }, storyWindow(entry.series).range),
      wholePackages,
      components: entry.from.length > 1 && wholePackages.length === 0 ? entry.from.length : null,
      empty: empty(series),
    };
  }
  if (history === null) return null;
  const { series, range } = storyWindow([{ cohortKey: `uses:${row.componentId}`, label: row.displayName, color: "", points: history }]);
  return { kind: "uses", entry: null, series, range, href: null, wholePackages: [], components: null, empty: empty(series) };
}
