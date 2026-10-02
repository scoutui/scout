"use client";
import { AlertTriangle, X } from "lucide-react";
import type { CohortRole, CohortSelector } from "@scoutui/web-shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { selectorKey } from "@/components/dashboards/dashboard-builder";
import { splitCohortLabel } from "@/lib/dashboard-format";
import { CohortSwatch } from "@/components/dashboards/cohort-swatch";

/**
 * One rendered series. `color`/`label` are resolved by the builder so the legend
 * matches the chart exactly (both colour through `chartColors`). `deprecatedOnly` is only
 * meaningful for `package`/`tag` selectors; the toggle is hidden for `component`/`local`.
 * `label` is "" while no name is known. `unknown` marks a series the chart left out, and
 * its `color` is "".
 */
export type LegendSeries = {
  selector: CohortSelector;
  label: string;
  color: string;
  role?: CohortRole | undefined;
  unknown: boolean;
};

type DeprecatableSelector = Extract<CohortSelector, { kind: "package" | "tag" }>;
const asDeprecatable = (s: CohortSelector): DeprecatableSelector | null =>
  s.kind === "package" || s.kind === "tag" ? s : null;

/**
 * The builder's series list, which is also the chart's legend. Each row shows the
 * series' chart colour, its name, a `deprecated only` filter for package and tag
 * series, and a remove control. A series the chart left out reads muted in sans, as
 * "Unknown component" or "Deleted tag" when it has no name, with an empty swatch.
 */
export function SeriesLegend({
  series,
  onRemove,
  onToggleDeprecatedOnly,
}: {
  series: LegendSeries[];
  onRemove: (index: number) => void;
  onToggleDeprecatedOnly: (index: number) => void;
}) {
  if (series.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {series.map((s, i) => {
        const deprecatable = asDeprecatable(s.selector);
        const deprecatedOnly = deprecatable?.deprecatedOnly === true;
        const placeholder = s.unknown && !s.label ? (s.selector.kind === "tag" ? "Deleted tag" : "Unknown component") : null;
        const label = s.label || placeholder || "";
        // The name on one line and the package beneath, as in the picker rows.
        const { name, packageName } = splitCohortLabel(label);
        const primary = name;
        const secondary = packageName ?? null;
        return (
          <li
            key={selectorKey(s.selector)}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/40"
          >
            <CohortSwatch cohortKey={selectorKey(s.selector)} color={s.color} role={s.role} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5" title={label || undefined}>
              <span className={cn("truncate text-xs", s.unknown ? "font-sans text-muted-foreground" : "font-mono")}>{primary}</span>
              {secondary ? (
                <span className={cn("truncate text-xs text-muted-foreground", s.unknown ? "font-sans" : "font-mono")}>{secondary}</span>
              ) : null}
            </span>
            {deprecatable ? (
              <button
                type="button"
                aria-pressed={deprecatedOnly}
                onClick={() => onToggleDeprecatedOnly(i)}
                className={cn(
                  // A bordered chip in both states so it reads as a toggle, not a label.
                  "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.6875rem] font-medium uppercase tracking-[0.05em] transition-colors",
                  deprecatedOnly
                    ? "border-status-warn-border bg-status-warn-tint text-status-warn-text"
                    : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                title={
                  deprecatedOnly
                    ? "Showing deprecated components only. Click to include all."
                    : "Show only deprecated components in this series."
                }
              >
                <AlertTriangle aria-hidden className="size-3" />
                deprecated only
              </button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onRemove(i)}
              aria-label={label ? `Remove ${placeholder ? placeholder.toLowerCase() : label}` : "Remove"}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
