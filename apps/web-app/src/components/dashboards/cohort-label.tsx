"use client";
import type { ReactNode } from "react";
import { DEPRECATED_ONLY, splitCohortLabel } from "@/lib/dashboard-format";
import { cn } from "@/lib/utils";

/**
 * A cohort label split into the name and its package, muted and a step smaller, then
 * `deprecated only` for a deprecated-only series. The title carries the full label.
 */
export function CohortLabelText({
  label,
  deprecatedOnly = false,
  className,
}: {
  label: string;
  deprecatedOnly?: boolean;
  className?: string;
}) {
  const { name, packageName } = splitCohortLabel(label);
  return (
    <span className={cn("inline-flex min-w-0 items-baseline gap-1.5 font-mono", className)} title={label}>
      <span className="truncate">{name}</span>
      {packageName !== undefined ? (
        <span className="truncate text-xs text-muted-foreground">{packageName}</span>
      ) : null}
      {deprecatedOnly ? <DeprecatedOnlyText /> : null}
    </span>
  );
}

function DeprecatedOnlyText() {
  return <span className="shrink-0 whitespace-nowrap font-sans text-xs text-muted-foreground">{DEPRECATED_ONLY}</span>;
}

export function TooltipSeriesName({ name, deprecatedOnly }: { name: ReactNode; deprecatedOnly: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="truncate font-mono text-muted-foreground">{name}</span>
      {deprecatedOnly ? <DeprecatedOnlyText /> : null}
    </span>
  );
}
