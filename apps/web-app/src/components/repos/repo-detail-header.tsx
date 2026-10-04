import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronLeft } from "lucide-react";
import type { RepoDetail, ScanSummary } from "@scoutui/web-shared";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { frameworkLabel } from "@/lib/framework-label";
import { parseGitRemote } from "@scoutui/scan-format/git-remote";
import { commitUrl } from "@/lib/git-remote";
import { relativeTime } from "@/lib/relative-time";
import { deltaTone } from "@/lib/scan-diff-view";
import { scannedLine } from "@/lib/scanned-line";
import { ScanDiffLine } from "./scan-diff-line";
import { ScanSwitcher } from "./scan-switcher";

/** Quiet meta-line link: inherits the muted colour, lifts to ink on hover, and
 *  wears the focus ring on keyboard focus. */
const META_LINK =
  "rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function RepoDetailHeader({
  detail,
  recentScans,
}: {
  detail: RepoDetail;
  recentScans: ScanSummary[];
}) {
  const remote = parseGitRemote(detail.gitRemote);
  const commitHref = commitUrl(detail.gitRemote, detail.commit);
  const scanned = scannedLine(detail.scope);

  return (
    <header className="space-y-4">
      <div className="space-y-2">
        <Link
          href="/repos"
          className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft aria-hidden className="size-3" />
          Repos
        </Link>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">{detail.repoId}</h1>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {remote ? (
            <a href={remote.href} className={`font-mono ${META_LINK}`}>
              {remote.display}
            </a>
          ) : (
            <span>no git remote</span>
          )}
          <Sep />
          <span>
            commit{" "}
            {commitHref ? (
              <a href={commitHref} className={`font-mono ${META_LINK}`}>
                {detail.commit.slice(0, 8)}
              </a>
            ) : (
              <span className="font-mono">{detail.commit.slice(0, 8)}</span>
            )}
          </span>
          {detail.branch ? (<><Sep /><span>branch <span className="font-mono">{detail.branch}</span></span></>) : null}
          <Sep />
          <span>
            committed <span title={formatAbsoluteUtc(detail.committedAt)}>{relativeTime(detail.committedAt)}</span>
          </span>
          <Sep />
          <span className="tabular-nums">{detail.packageCount.toLocaleString()} {detail.packageCount === 1 ? "package" : "packages"}</span>
          <Sep />
          <ScanSwitcher
            repoId={detail.repoId}
            currentScanId={detail.scanId}
            recentScans={recentScans}
            totalScanCount={detail.scanCount}
            gitRemote={detail.gitRemote}
          />
        </div>
        {scanned ? <p className="text-xs text-muted-foreground">{scanned}</p> : null}
      </div>

      {/* Framework split */}
      {detail.frameworkCounts.length > 1 ? (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {[...detail.frameworkCounts]
            .sort((a, b) => b.count - a.count)
            .map((f) => (
              <span key={f.kind} className="whitespace-nowrap">
                {frameworkLabel(f.kind)}{" "}
                <span className="tabular-nums text-foreground">{f.count.toLocaleString()}</span>
              </span>
            ))}
        </div>
      ) : null}

      {/* Status row: deprecated components in use and their movement since
          the previous scan first, then what else moved. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {detail.deprecatedCount > 0 ? (
          // Centred, not baseline-aligned: the alarm is itself a centred
          // flex box whose baseline is its icon's, so baseline alignment
          // drops the suffix 2.5px below the alarm's text.
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <span className="inline-flex items-center gap-1.5 text-xs text-status-warn-text">
              <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
              <span className="font-medium tabular-nums">{detail.deprecatedCount.toLocaleString()}</span>
              {detail.deprecatedCount === 1 ? "deprecated component in use" : "deprecated components in use"}
            </span>
            {detail.diff !== null && detail.diff.deprecatedNow !== detail.diff.deprecatedPrev ? (
              <span className="text-xs text-muted-foreground">
                <span aria-hidden className="text-muted-foreground/70">·</span>{" "}
                <DeprecatedMovement prev={detail.diff.deprecatedPrev} now={detail.diff.deprecatedNow} />
              </span>
            ) : null}
          </span>
        ) : detail.diff !== null && detail.diff.deprecatedPrev > 0 ? (
          // A finished retirement: no alarm, but the movement still shows in
          // the same slot.
          <span className="inline-flex items-baseline gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 aria-hidden className="size-3.5 shrink-0 translate-y-0.5" />
            <span>
              no deprecated components in use{" "}
              <span aria-hidden className="text-muted-foreground/70">·</span>{" "}
              <DeprecatedMovement prev={detail.diff.deprecatedPrev} now={detail.diff.deprecatedNow} />
            </span>
          </span>
        ) : null}

        <ScanDiffLine diff={detail.diff} committedAt={detail.committedAt} />
      </div>
    </header>
  );
}

function Sep() {
  return <span aria-hidden className="text-border">·</span>;
}

/** `2 fewer than the previous scan` / `3 more than the previous scan`. The count
 *  and the diff come from the same governance data at the same grain, so the
 *  movement agrees with the alarm's number. `2 fewer` / `3 more` take
 *  `deltaTone`'s retirement polarity (more is red, fewer is plain ink). */
function DeprecatedMovement({ prev, now }: { prev: number; now: number }) {
  const fewer = prev - now;
  return (
    <>
      <span className={`font-medium tabular-nums ${deltaTone(now - prev, true)}`}>
        {Math.abs(fewer).toLocaleString()}
        {fewer > 0 ? " fewer" : " more"}
      </span>
      {" than the previous scan"}
    </>
  );
}
