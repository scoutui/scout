"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Check } from "lucide-react";
import type { RepoDetail, ScanSummary } from "@scoutui/web-shared";
import { friendlyKind } from "@scoutui/web-shared/client";
import { commitUrl } from "@/lib/git-remote";
import { kindLabel } from "@/lib/component-facets";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { buttonVariants } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { relativeTime } from "@/lib/relative-time";
import { shortScanId } from "@/lib/scan-id";
import { adjacentScans, recentScanWindow, scanCountLabel, scanHref } from "@/lib/scan-switcher";
import { cn } from "@/lib/utils";

const RECENT_LIMIT = 8;
const LABEL_ID = "scan-switcher-recent-label";

export type ScanSwitcherDetail = Pick<RepoDetail, "repoId" | "scanId" | "gitRemote" | "arrivedAt" | "scanCount" | "packageCount" | "frameworkCounts" | "scannerVersion">;

export function ScanSwitcher({
  detail,
  recentScans,
}: {
  detail: ScanSwitcherDetail;
  recentScans: ScanSummary[];
}) {
  const { repoId, scanId: currentScanId, gitRemote } = detail;
  const latestScanId = recentScans[0]?.scanId;
  const sliced = recentScanWindow(recentScans, currentScanId, RECENT_LIMIT);
  const { older, newer } = adjacentScans(recentScans, currentScanId);
  const canStep = older !== undefined || newer !== undefined;
  const frameworks = [...detail.frameworkCounts].sort((a, b) => b.count - a.count);

  return (
    <Popover>
      <div className="inline-flex items-stretch">
        {canStep && !older ? <StepSpacer /> : null}
        <ButtonGroup>
          {older ? (
            <Step label="Previous scan" scan={older} repoId={repoId} latestScanId={latestScanId}>
              <ChevronLeft aria-hidden />
            </Step>
          ) : null}
          <PopoverTrigger
            title={formatAbsoluteUtc(detail.arrivedAt)}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "group font-normal")}
          >
            Scanned {relativeTime(detail.arrivedAt)}
            <ChevronDown
              aria-hidden
              className="size-3 text-muted-foreground transition-transform group-data-[popup-open]:rotate-180"
            />
          </PopoverTrigger>
          {newer ? (
            <Step label="Next scan" scan={newer} repoId={repoId} latestScanId={latestScanId}>
              <ChevronRight aria-hidden />
            </Step>
          ) : null}
        </ButtonGroup>
        {canStep && !newer ? <StepSpacer /> : null}
      </div>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0"
      >
        <PopoverTitle
          id={LABEL_ID}
          className="px-3 pt-2.5 pb-1 text-label text-muted-foreground"
        >
          Scans
        </PopoverTitle>
        <ul aria-labelledby={LABEL_ID} className="flex flex-col px-1 pb-1">
          {sliced.map(s => {
            const isCurrent = s.scanId === currentScanId;
            return (
              <li
                key={s.scanId}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                  "hover:bg-accent/50 has-[a:focus-visible]:bg-accent/50",
                  isCurrent && "selected",
                )}
              >
                <Link
                  href={scanHref(repoId, s.scanId, latestScanId)}
                  aria-current={isCurrent ? "page" : undefined}
                  title={s.scanId}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  <Check
                    aria-hidden
                    className={cn(
                      "size-3 shrink-0 text-foreground",
                      isCurrent ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="shrink-0 text-foreground" title={formatAbsoluteUtc(s.arrivedAt)}>
                    {relativeTime(s.arrivedAt)}
                  </span>
                  {s.scanId === latestScanId ? <span className="shrink-0 text-muted-foreground">· latest</span> : null}
                  <span className="ml-auto min-w-0 truncate text-right font-mono text-muted-foreground">
                    {s.branch ?? ""}
                  </span>
                </Link>
                <CommitRef gitRemote={gitRemote} sha={s.commit} />
              </li>
            );
          })}
          <li>
            <Link
              href={`/repos/${encodeURIComponent(repoId)}/scans`}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-accent/50"
            >
              All {scanCountLabel(detail.scanCount)}
              <ChevronRight aria-hidden className="size-3 text-muted-foreground" />
            </Link>
          </li>
        </ul>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 border-t border-border px-3 py-2.5 text-xs">
          <Fact term="Scan">
            <span className="font-mono" title={currentScanId}>{shortScanId(currentScanId)}</span>
          </Fact>
          <Fact term="Packages">
            <span className="tabular-nums">{detail.packageCount.toLocaleString()}</span>
          </Fact>
          {frameworks.length > 1 ? (
            <Fact term="Frameworks">
              <ul className="flex flex-wrap gap-x-3">
                {frameworks.map(f => (
                  <li key={f.kind} className="whitespace-nowrap">
                    {kindLabel(friendlyKind(f.kind))} <span className="tabular-nums">{f.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </Fact>
          ) : null}
          <Fact term="Scanner">
            <span className="font-mono">{detail.scannerVersion}</span>
          </Fact>
        </dl>
      </PopoverContent>
    </Popover>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

/** A step to the ready scan before or after the shown one. */
function Step({ label, scan, repoId, latestScanId, children }: {
  label: string;
  scan: ScanSummary;
  repoId: string;
  latestScanId: string | undefined;
  children: ReactNode;
}) {
  return (
    <Link
      href={scanHref(repoId, scan.scanId, latestScanId)}
      aria-label={label}
      title={`${label}, scanned ${relativeTime(scan.arrivedAt)}`}
      className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "text-muted-foreground")}
    >
      {children}
    </Link>
  );
}

/** A missing step's width, outside the group at either end of the history, so the right-aligned trigger doesn't move. Not shown on a phone, where the control sits on the left edge. */
function StepSpacer() {
  return <span aria-hidden className="invisible hidden w-7 shrink-0 sm:block" />;
}

/** A scan's commit: linked to the forge when the remote is a known host
 *  (`commitUrl`), otherwise the short sha as plain mono text. */
function CommitRef({ gitRemote, sha }: { gitRemote: string | null; sha: string }) {
  const href = commitUrl(gitRemote, sha);
  const short = sha.slice(0, 7);
  const width = "w-14 shrink-0 text-right font-mono text-muted-foreground";
  return href ? (
    <a
      href={href}
      title={sha}
      className={`${width} rounded-sm underline-offset-4 hover:text-foreground hover:underline`}
    >
      {short}
    </a>
  ) : (
    <span title={sha} className={width}>
      {short}
    </span>
  );
}
