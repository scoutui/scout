"use client";
import Link from "next/link";
import { ChevronDown, Check } from "lucide-react";
import type { ScanSummary } from "@scoutui/web-shared";
import { commitUrl } from "@/lib/git-remote";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { relativeTime } from "@/lib/relative-time";
import { shortScanId } from "@/lib/scan-id";
import { recentScanWindow, scanCountLabel, scanHref } from "@/lib/scan-switcher";
import { cn } from "@/lib/utils";

const RECENT_LIMIT = 8;
const LABEL_ID = "scan-switcher-recent-label";

export function ScanSwitcher({
  repoId,
  currentScanId,
  recentScans,
  totalScanCount,
  gitRemote,
}: {
  repoId: string;
  currentScanId: string;
  recentScans: ScanSummary[];
  totalScanCount: number;
  /** The repo's git remote, for linking each scan's commit to its forge. */
  gitRemote: string | null;
}) {
  const encoded = encodeURIComponent(repoId);
  const latestScanId = recentScans[0]?.scanId;
  const sliced = recentScanWindow(recentScans, currentScanId, RECENT_LIMIT);

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Switch scan; currently scan ${shortScanId(currentScanId)}`}
        title={currentScanId}
        className={cn(
          "group relative inline-flex items-baseline gap-1 rounded-sm text-xs text-muted-foreground",
          "after:absolute after:inset-[min(0px,(100%_-_24px)/2)] after:content-['']",
          "transition-colors hover:text-foreground",
        )}
      >
        <span>scan <span className="font-mono">{shortScanId(currentScanId)}</span></span>
        <ChevronDown
          aria-hidden
          className="size-3 self-center transition-transform group-data-[popup-open]:rotate-180"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-96 gap-0 p-0"
      >
        <PopoverTitle
          id={LABEL_ID}
          className="px-3 py-2 text-label font-normal text-muted-foreground"
        >
          Recent scans
        </PopoverTitle>
        <ul aria-labelledby={LABEL_ID} className="flex flex-col">
          {sliced.map(s => {
            const isCurrent = s.scanId === currentScanId;
            const href = scanHref(repoId, s.scanId, latestScanId);
            return (
              <li
                key={s.scanId}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-xs transition-colors",
                  "hover:bg-accent/50 has-[a:focus-visible]:bg-accent/50",
                  isCurrent && "selected",
                )}
              >
                <Link
                  href={href}
                  aria-current={isCurrent ? "page" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  <Check
                    aria-hidden
                    className={cn(
                      "size-3 shrink-0 text-foreground",
                      isCurrent ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="font-mono text-foreground" title={s.scanId}>
                    {shortScanId(s.scanId)}
                  </span>
                  <span
                    className="ml-auto w-20 text-right text-muted-foreground"
                    title={formatAbsoluteUtc(s.committedAt)}
                  >
                    {relativeTime(s.committedAt)}
                  </span>
                  <span className="w-24 truncate text-right font-mono text-muted-foreground">
                    {s.branch ?? "—"}
                  </span>
                </Link>
                <CommitRef gitRemote={gitRemote} sha={s.commit} />
              </li>
            );
          })}
        </ul>
        <div className="border-t px-3 py-2">
          <Link
            href={`/repos/${encoded}/scans`}
            className="inline-flex items-center gap-1 text-xs text-foreground hover:underline"
          >
            View all {scanCountLabel(totalScanCount)} →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
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
