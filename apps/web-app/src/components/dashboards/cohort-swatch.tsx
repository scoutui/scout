import { AlertTriangle } from "lucide-react";
import type { CohortRole } from "@scoutui/web-shared";
import { cn } from "@/lib/utils";

/**
 * Identity swatch for a chart key. Tag series get a pill, and package, component
 * and local series a square, keyed off the cohortKey prefix. A deprecated-role
 * series gets the warning triangle in the series colour instead, with the word in
 * an `sr-only` span as `DeprecatedMark` does.
 */
export function CohortSwatch({
  cohortKey,
  color,
  role,
  className,
}: {
  cohortKey: string;
  color: string;
  role?: CohortRole | undefined;
  className?: string;
}) {
  if (role === "deprecated") {
    return (
      <>
        <AlertTriangle aria-hidden className={cn("size-3 shrink-0", className)} style={{ color }} />
        <span className="sr-only">deprecated</span>
      </>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0",
        cohortKey.startsWith("tag:") ? "h-2.5 w-4 rounded-full" : "size-2.5 rounded-[3px]",
        className,
      )}
      style={{ backgroundColor: color }}
    />
  );
}
