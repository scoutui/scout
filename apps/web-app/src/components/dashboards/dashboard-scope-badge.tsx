import { AlertTriangle, Clock, FolderOpen } from "lucide-react";
import type { DashboardConfig } from "@scoutui/web-shared";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * A dashboard's scope: a folder badge with the repoId for a repo scope, a quiet
 * outline chip for all repos. Uses `badgeVariants` on a plain span (no hook) so it
 * renders in both server and client components.
 *
 * `missing` marks a repo scope with no scans: `"scans"` when the repo exists but has
 * none yet, `"repo"` when the repo itself is gone (a rename changes the repoId).
 */
export function DashboardScopeBadge({
  scope,
  missing,
}: {
  scope: DashboardConfig["scope"];
  missing?: "scans" | "repo" | undefined;
}) {
  if (scope.kind === "repo") {
    if (missing === "repo") {
      return (
        <span
          className={cn(badgeVariants({ variant: "warning" }), "font-mono font-normal")}
          title="There are no scans for this repo any more. It may have been renamed or deleted."
        >
          <AlertTriangle aria-hidden />
          {scope.repoId} · missing
        </span>
      );
    }
    if (missing === "scans") {
      return (
        <span
          className={cn(badgeVariants({ variant: "secondary" }), "font-mono font-normal")}
          title="This repo has no scans yet. Its charts fill in after its first scan is uploaded."
        >
          <Clock aria-hidden />
          {scope.repoId} · no scans yet
        </span>
      );
    }
    return (
      <span className={cn(badgeVariants({ variant: "secondary" }), "font-mono font-normal")}>
        <FolderOpen aria-hidden />
        {scope.repoId}
      </span>
    );
  }
  return (
    <span className={cn(badgeVariants({ variant: "outline" }), "font-normal text-muted-foreground")}>
      All repos
    </span>
  );
}

/** Marks a saved chart with a series nothing can name any more: a component no scan holds, or a deleted tag. */
export function UnknownComponentsBadge() {
  return (
    <span className={cn(badgeVariants({ variant: "warning" }), "font-normal")}>
      <AlertTriangle aria-hidden />
      Some components can&apos;t be found
    </span>
  );
}
