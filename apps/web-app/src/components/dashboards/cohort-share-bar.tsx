"use client";
import type { CohortRole } from "@scoutui/web-shared";
import { DEPRECATED_ONLY, formatPct } from "@/lib/dashboard-format";
import { cn } from "@/lib/utils";
import { CohortLabelText } from "@/components/dashboards/cohort-label";
import { CohortSwatch } from "@/components/dashboards/cohort-swatch";

/** The minimal cohort shape the bar needs. CohortPoint satisfies it, and the
 *  share-over-time view derives it from each series' latest point. */
export type ShareSegment = { cohortKey: string; label: string; value: number; role?: CohortRole | undefined; deprecatedOnly?: boolean };

/**
 * A single stacked bar of each cohort's share of the in-scope total, with a labelled
 * row beneath so colour is never the only key. Segments are separated by a 2px gap
 * and sized by share of the total, whatever the metric. When `onHover` is set (as
 * in the share-over-time view), the labelled row is an interactive legend: hovering
 * an entry highlights its segment and band.
 */
export function CohortShareBar({
  points,
  colors,
  hovered = null,
  onHover,
}: {
  points: ShareSegment[];
  colors: ReadonlyMap<string, string>;
  hovered?: string | null;
  onHover?: (cohortKey: string | null) => void;
}) {
  const total = points.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) {
    return <p className="text-sm text-muted-foreground">No uses yet.</p>;
  }
  const segs = points.map((p) => {
    const share = p.value / total;
    return { key: p.cohortKey, label: p.label, share, color: colors.get(p.cohortKey) ?? "", role: p.role, deprecatedOnly: p.deprecatedOnly === true };
  });

  return (
    <div>
      <div
        className="flex h-5 w-full gap-[2px] overflow-hidden rounded-md"
        role="img"
        aria-label={segs.map((s) => `${s.label}${s.deprecatedOnly ? ` ${DEPRECATED_ONLY}` : ""} ${formatPct(s.share)}`).join(", ")}
      >
        {/* The min-width and grow floors keep a tiny share visible. A zero share
            gets no segment; the row beneath still lists it at 0%. */}
        {segs
          .filter((s) => s.share > 0)
          .map((s) => (
            <span
              key={s.key}
              className={cn(
                "h-full min-w-[3px] transition-opacity duration-200 first:rounded-l-md last:rounded-r-md",
                hovered !== null && hovered !== s.key && "opacity-30",
              )}
              style={{ flexGrow: Math.max(s.share, 0.008), flexBasis: 0, backgroundColor: s.color }}
              title={`${s.label} ${formatPct(s.share)}`}
            />
          ))}
      </div>
      <div className="-mx-2.5 mt-2 -mb-1 flex flex-wrap text-xs">
        {segs.map((s) =>
          onHover ? (
            <button
              key={s.key}
              type="button"
              onMouseEnter={() => onHover(s.key)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(s.key)}
              onBlur={() => onHover(null)}
              className={cn(
                "inline-flex min-h-6 cursor-default items-center gap-1.5 whitespace-nowrap px-2.5 transition-opacity duration-200 pointer-coarse:min-h-11",
                "rounded-sm",
                hovered !== null && hovered !== s.key && "opacity-40",
              )}
            >
              <CohortSwatch cohortKey={s.key} color={s.color} role={s.role} className="inline-block" />
              <CohortLabelText label={s.label} deprecatedOnly={s.deprecatedOnly} />
              <span className="font-medium tabular-nums text-foreground">{formatPct(s.share)}</span>
            </button>
          ) : (
            <span key={s.key} className="inline-flex min-h-6 items-center gap-1.5 whitespace-nowrap px-2.5">
              <CohortSwatch cohortKey={s.key} color={s.color} role={s.role} className="inline-block" />
              <CohortLabelText label={s.label} deprecatedOnly={s.deprecatedOnly} />
              <span className="font-medium tabular-nums text-foreground">{formatPct(s.share)}</span>
            </span>
          ),
        )}
      </div>
    </div>
  );
}
