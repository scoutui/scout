import { AlertTriangle } from "lucide-react";
import type { CohortRole } from "@scoutui/web-shared";
import { dashSwatchSegments } from "@/lib/dashboard-chart-data";
import { cn } from "@/lib/utils";

/**
 * Identity swatch for a chart key. Tag series get a pill, and package, component
 * and local series a square, keyed off the cohortKey prefix. A deprecated-role
 * series gets the warning triangle in the series colour instead, with the word in
 * an `sr-only` span as `DeprecatedMark` does: cohort labels never carry the word,
 * so the triangle is the only thing naming that series as deprecated.
 */
export function CohortSwatch({
  cohortKey,
  color,
  dash,
  role,
  className,
}: {
  cohortKey: string;
  color: string;
  /**
   * The series' stroke-dasharray (from `seriesDashes`), or undefined for a solid
   * series. Each pattern renders as its own repeating gradient scaled to the
   * swatch, so two same-colour series never share a swatch.
   */
  dash?: string | undefined;
  role?: CohortRole | undefined;
  className?: string;
}) {
  // The triangle carries no dash rhythm: two deprecated-role series key identically.
  if (role === "deprecated") {
    return (
      <>
        <AlertTriangle aria-hidden className={cn("size-3 shrink-0", className)} style={{ color }} />
        <span className="sr-only">deprecated</span>
      </>
    );
  }
  const segments = dash ? dashSwatchSegments(dash) : [];
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0",
        cohortKey.startsWith("tag:") ? "h-2.5 w-4 rounded-full" : "size-2.5 rounded-[3px]",
        className,
      )}
      style={segments.length > 0 ? { background: dashGradient(color, segments) } : { backgroundColor: color }}
    />
  );
}

/** Build the CSS repeating-linear-gradient string for a swatch's scaled dash segments. */
function dashGradient(color: string, segments: number[]): string {
  let pos = 0;
  const stops = segments.map((len, i) => {
    const from = pos;
    pos += len;
    return `${i % 2 === 0 ? color : "transparent"} ${from}px ${pos}px`;
  });
  return `repeating-linear-gradient(90deg, ${stops.join(", ")})`;
}
