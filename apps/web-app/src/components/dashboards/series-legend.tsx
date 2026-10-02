"use client";
import { Ellipsis, X } from "lucide-react";
import type { CohortRole, CohortSelector } from "@scoutui/web-shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { selectorKey } from "@/components/dashboards/dashboard-builder";
import { splitCohortLabel } from "@/lib/dashboard-format";
import { CohortSwatch } from "@/components/dashboards/cohort-swatch";

/**
 * One rendered series. `color`/`label` are resolved by the builder so the legend
 * matches the chart exactly (both colour through `chartColors`). `deprecatedOnly` is
 * null when the row offers no "Only deprecated components" option; otherwise it holds
 * whether the option is on and the line shown under it, if any.
 * `label` is "" while no name is known. `unknown` marks a series the chart left out, and
 * its `color` is "".
 */
export type LegendSeries = {
  selector: CohortSelector;
  label: string;
  color: string;
  role?: CohortRole | undefined;
  unknown: boolean;
  deprecatedOnly: { on: boolean; text: string | null } | null;
};

/**
 * The builder's series list, which is also the chart's legend. Each row shows the
 * series' chart colour, its name, and a remove control. A package or tag series that
 * can be narrowed to its deprecated components gets a row menu holding that option, and
 * reads `<name> · deprecated` while it is on. A series the chart left out reads muted in
 * sans, as "Unknown component" or "Deleted tag" when it has no name, with an empty swatch.
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
        const narrowed = (s.selector.kind === "package" || s.selector.kind === "tag") && s.selector.deprecatedOnly === true;
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
              <span className="flex min-w-0 items-baseline">
                <span className={cn("truncate text-xs", s.unknown ? "font-sans text-muted-foreground" : "font-mono")}>{primary}</span>
                {narrowed ? (
                  <span aria-hidden className="ml-1 shrink-0 font-sans text-xs text-muted-foreground">
                    · deprecated
                  </span>
                ) : null}
              </span>
              {secondary ? (
                <span className={cn("truncate text-xs text-muted-foreground", s.unknown ? "font-sans" : "font-mono")}>{secondary}</span>
              ) : null}
            </span>
            {s.deprecatedOnly ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={label ? `Options for ${placeholder ? placeholder.toLowerCase() : label}` : "Options"}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    />
                  }
                >
                  <Ellipsis aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuCheckboxItem
                    checked={s.deprecatedOnly.on}
                    onCheckedChange={() => onToggleDeprecatedOnly(i)}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div>Only deprecated components</div>
                      {s.deprecatedOnly.text ? (
                        <div className="text-xs text-muted-foreground">{s.deprecatedOnly.text}</div>
                      ) : null}
                    </div>
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
