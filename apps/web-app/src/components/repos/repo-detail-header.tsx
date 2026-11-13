import Link from "next/link";
import { AlertTriangle, CheckCircle2, Settings } from "lucide-react";
import type { RepoDetail, ScanSummary } from "@scoutui/web-shared";
import { BackLink } from "@/components/ui/back-link";
import { buttonVariants } from "@/components/ui/button";
import { parseGitRemote } from "@scoutui/scan-format/git-remote";
import { commitUrl } from "@/lib/git-remote";
import { deltaTone, signedCount } from "@/lib/scan-diff-view";
import { cn } from "@/lib/utils";
import { ScanDiffLine } from "./scan-diff-line";
import { ScanFindingRows } from "./scan-findings";
import { StatusLine } from "./scan-gaps";
import { ScanSwitcher } from "./scan-switcher";
import { ViewingOlderScanBanner } from "./viewing-older-scan-banner";

/** The repo page's header. Every count in it comes from the shown scan, which an older-scan strip names when it isn't the latest. */
export function RepoDetailHeader({
  detail,
  recentScans,
  olderScan = false,
  canOpenSettings = false,
}: {
  detail: RepoDetail;
  recentScans: ScanSummary[];
  olderScan?: boolean;
  canOpenSettings?: boolean;
}) {
  const remote = parseGitRemote(detail.gitRemote);
  const commitHref = commitUrl(detail.gitRemote, detail.commit);
  const shortCommit = detail.commit.slice(0, 7);
  const { repoId, scanId, gitRemote, arrivedAt, scanCount, packageCount, frameworkCounts, scannerVersion } = detail;

  return (
    <header className="space-y-3">
      <BackLink href="/repos">Repos</BackLink>
      {olderScan ? <ViewingOlderScanBanner repoId={detail.repoId} arrivedAt={detail.arrivedAt} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="min-w-0 font-mono text-2xl font-semibold [overflow-wrap:anywhere]">{detail.repoId}</h1>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ScanSwitcher detail={{ repoId, scanId, gitRemote, arrivedAt, scanCount, packageCount, frameworkCounts, scannerVersion }} recentScans={recentScans} />
          {canOpenSettings ? (
            <Link
              href={`/repos/${encodeURIComponent(detail.repoId)}/settings`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground")}
            >
              <Settings aria-hidden />
              Settings
            </Link>
          ) : null}
        </div>
      </div>
      <StatusLine gapCount={detail.findings.length} gaps={<ScanFindingRows findings={detail.findings} />}>
        <span className="inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-4">
          {remote ? (
            <a href={remote.href} className="min-w-0 rounded-sm font-mono [overflow-wrap:anywhere] underline-offset-4 hover:text-foreground hover:underline">
              {remote.display}
            </a>
          ) : null}
          <span className="flex min-w-0 max-w-full items-baseline gap-x-1.5">
            {commitHref ? (
              <a href={commitHref} title={detail.commit} className="shrink-0 rounded-sm font-mono text-foreground underline-offset-4 hover:underline">
                {shortCommit}
              </a>
            ) : (
              <span title={detail.commit} className="shrink-0 font-mono text-foreground">{shortCommit}</span>
            )}
            {detail.branch ? (
              <span title={detail.branch} className="min-w-0 truncate">
                on <span className="font-mono text-foreground">{detail.branch}</span>
              </span>
            ) : null}
          </span>
        </span>
        <DeprecatedInUse detail={detail} />
        <ScanDiffLine delta={detail.delta} />
      </StatusLine>
    </header>
  );
}

/** `5 deprecated in use (−2)`: the count in warning colour, and its movement since the previous scan in `deltaTone`'s
 *  retirement polarity (more is red, fewer is plain ink). A finished retirement keeps the movement without the alarm. */
function DeprecatedInUse({ detail }: { detail: RepoDetail }) {
  const moved = detail.delta?.deprecated ?? 0;
  const movement = moved !== 0 ? (
    <span className="text-muted-foreground">
      {" ("}
      <span className={cn("font-medium tabular-nums", deltaTone(moved, true))}>{signedCount(moved)}</span>
      <span className="sr-only"> since previous scan</span>
      {")"}
    </span>
  ) : null;
  if (detail.deprecatedCount > 0) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-status-warn" />
        <span>
          <span className="text-status-warn-text">
            <span className="font-medium tabular-nums">{detail.deprecatedCount.toLocaleString()}</span> deprecated in use
          </span>
          {movement}
        </span>
      </span>
    );
  }
  if (moved === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <CheckCircle2 aria-hidden className="size-3.5 shrink-0" />
      <span>None deprecated in use{movement}</span>
    </span>
  );
}
