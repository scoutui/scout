"use client";
import { splitCohortLabel } from "@/lib/dashboard-format";
import { cn } from "@/lib/utils";

/**
 * A cohort label split into the name and its package, muted and a step smaller.
 * The title carries the full label.
 */
export function CohortLabelText({ label, className }: { label: string; className?: string }) {
  const { name, packageName } = splitCohortLabel(label);
  return (
    <span className={cn("inline-flex min-w-0 items-baseline gap-1.5 font-mono", className)} title={label}>
      <span className="truncate">{name}</span>
      {packageName !== undefined ? (
        <span className="truncate text-xs text-muted-foreground">{packageName}</span>
      ) : null}
    </span>
  );
}
