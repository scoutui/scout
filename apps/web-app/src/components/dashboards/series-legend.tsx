"use client";
import { AlertTriangle, Ellipsis, X } from "lucide-react";
import type { CohortRole, CohortSelector } from "@scoutui/web-shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * One rendered series. `color`/`label` are resolved by the builder so the legend
 * matches the chart exactly (both colour through `chartColors`). `deprecatedOnly` is
 * null when the row offers no "Only deprecated components" option; otherwise it holds
 * whether the option is on and the line shown under it, if any.
 * `label` is "" while no name is known. `unknown` marks a series the chart left out, and
 * its `color` is "". `missingFrom` names the repo a left-out series isn't in, when another
 * repo's latest scan holds it.
 */
export type LegendSeries = {
  selector: CohortSelector;
  label: string;
  color: string;
  role?: CohortRole | undefined;
  unknown: boolean;
  missingFrom: string | null;
  deprecatedOnly: { on: boolean; text: string | null } | null;
};

/**
 * A series' name as the series table shows it, "Unknown component" or "Deleted tag" when a left-out series has none,
 * and as its buttons say it.
 */
export function legendNames(s: LegendSeries): { label: string; spoken: string } {
  const placeholder = s.unknown && !s.label ? (s.selector.kind === "tag" ? "Deleted tag" : "Unknown component") : null;
  const label = s.label || placeholder || "";
  return { label, spoken: placeholder ? placeholder.toLowerCase() : label };
}

/** "Not in <repo>" under the name of a series the chart left out because its repo doesn't have it. */
export function MissingFrom({ repoId }: { repoId: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 font-sans text-xs text-status-warn-text">
      <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate" title={`Not in ${repoId}`}>Not in <span className="font-mono">{repoId}</span></span>
    </span>
  );
}

/**
 * A series' controls in the chart builder, marked with the series' place in the chart as `data-series`: a menu holding
 * "Only deprecated components" when the series offers it, and a remove button marked `data-remove`, each named for the
 * series.
 */
export function SeriesActions({
  series,
  index,
  onRemove,
  onToggleDeprecatedOnly,
}: {
  series: LegendSeries;
  index: number;
  onRemove: (button: HTMLButtonElement) => void;
  onToggleDeprecatedOnly: () => void;
}) {
  const { spoken } = legendNames(series);
  return (
    <span data-series={index} className="flex items-center justify-end gap-0.5">
      {series.deprecatedOnly ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={spoken ? `Options for ${spoken}` : "Options"}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              />
            }
          >
            <Ellipsis aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuCheckboxItem checked={series.deprecatedOnly.on} onCheckedChange={onToggleDeprecatedOnly}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <div>Only deprecated components</div>
                {series.deprecatedOnly.text ? (
                  <div className="text-xs text-muted-foreground">{series.deprecatedOnly.text}</div>
                ) : null}
              </div>
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <Button
        variant="ghost"
        size="icon-xs"
        data-remove=""
        onClick={(event) => onRemove(event.currentTarget)}
        aria-label={spoken ? `Remove ${spoken}` : "Remove"}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X aria-hidden />
      </Button>
    </span>
  );
}
