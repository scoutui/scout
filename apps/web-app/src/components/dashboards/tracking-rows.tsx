import type { GovernanceTracking } from "@scoutui/web-shared";
import { deltaDirection, formatChange, formatPct, formatReposAdded } from "@/lib/dashboard-format";
import { cn } from "@/lib/utils";

/** A tracking entry's numbers on one line, for its chart page: "40% migrated · 24 left · 6 fewer in the last 30 days". */
export function TrackingReadout({ entry }: { entry: GovernanceTracking }) {
  const direction = deltaDirection(entry.delta);
  const reposAdded = formatReposAdded(entry.reposAdded);
  return (
    <p className="text-sm tabular-nums text-muted-foreground">
      {entry.kind === "migration" ? (
        <>
          <span className="font-medium text-foreground">{entry.progress === null ? "—" : formatPct(entry.progress)}</span> migrated ·{" "}
        </>
      ) : null}
      <span className="font-medium text-foreground">{entry.remaining.toLocaleString()}</span> left
      {entry.delta === null ? null : (
        <>
          {" · "}
          <span className={cn(direction === "backward" ? "font-medium text-status-err" : direction === "forward" ? "font-medium text-status-ok" : undefined)}>
            {formatChange(entry.delta)}
          </span>{" "}
          in the last 30 days
        </>
      )}
      {reposAdded ? ` · ${reposAdded}` : null}
    </p>
  );
}
