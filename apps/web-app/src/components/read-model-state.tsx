import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, CircleX, Clock } from "lucide-react";
import {
  readModelTitle, type ChartResultsNotice, type ReadModelUnavailable, type ScanFallbackNotice, type ScanGapNotice, type SkippedState, type UnavailableScan,
} from "@/lib/read-model-state";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { relativeTime } from "@/lib/relative-time";
import { EmptyState } from "@/components/ui/empty-state";
import { RecheckWhilePreparing, RefreshPageWhilePreparing } from "@/components/refresh-while-preparing";
import { cn } from "@/lib/utils";

const RETRY_GUIDE = "https://scoutui.dev/docs/guides/deploy-the-dashboard#retry-scans-that-failed-to-rebuild";

/** The page's own heading, from what its URL names. With `back`, it is a detail page's heading under a back link. */
type PageHeading = { title: string; code?: boolean; back?: { href: string; label: string; code?: boolean } };

type Props = ReadModelUnavailable & {
  heading?: PageHeading;
  /** Shown inside a page, in place of a section or beside it. */
  embedded?: boolean;
  /** Shown beside stored numbers that the page still displays. */
  besideNumbers?: boolean;
  /** Re-checks a client-side request while preparing, in place of re-rendering the page. */
  refresh?: () => void;
};

function message(state: ReadModelUnavailable["state"], scans: UnavailableScan[], embedded: boolean, besideNumbers: boolean): string {
  if (state === "preparing") return embedded ? "This loads on its own when it's ready." : "This page loads on its own when it's ready.";
  if (state === "degraded") {
    const again = scans.length > 1 ? "Scan these commits again to replace them." : "Scan this commit again to replace it.";
    return besideNumbers ? `Some scan data can't be read. ${again}` : again;
  }
  return besideNumbers ? "Some scan data couldn't be prepared. Ask your dashboard administrator to retry it." : "Ask your dashboard administrator to retry it.";
}

const shortCommit = (commit: string) => commit.slice(0, 7);
const scanLabel = (scan: UnavailableScan) => `${scan.repoId} · ${shortCommit(scan.commit)}`;

const retryGuide = <a href={RETRY_GUIDE} className="text-foreground underline-offset-4 hover:underline">How to retry</a>;

function ScanList({ scans }: { scans: UnavailableScan[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 font-mono text-muted-foreground">
      {scans.map(scan => <li key={scan.scanId} className="break-all">{scanLabel(scan)}</li>)}
    </ul>
  );
}

/** #816's one-row band: a status glyph, a title and a line, an optional list and link, wrapping on narrow screens. */
function StatusBand({ failed, role, title, line, list, link, poll }: {
  failed: boolean; role: "status" | "alert" | undefined; title: ReactNode; line: ReactNode; list?: ReactNode; link?: ReactNode; poll?: ReactNode;
}) {
  const Icon = failed ? CircleX : Clock;
  return (
    <div role={role} className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-accent/40 px-3 py-2 text-xs">
      <Icon aria-hidden className={cn("mt-px size-3.5 shrink-0", failed ? "text-status-err" : "text-muted-foreground")} />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-muted-foreground">{line}</p>
        {list}
      </div>
      {link ? <span className="shrink-0">{link}</span> : null}
      {poll}
    </div>
  );
}

export const fallbackStates: Record<SkippedState, string> = { preparing: "is being prepared", failed: "couldn't be prepared", degraded: "can't be read" };

function fallbackRow(fallback: ScanFallbackNotice, ownPage: boolean): { title: ReactNode; line: ReactNode } {
  const repo = <span className="break-all font-mono">{fallback.repoId}</span>;
  const again = fallback.state === "degraded" ? <> Scan <span className="font-mono">{shortCommit(fallback.latest.commit)}</span> again to replace it.</> : null;
  if (!fallback.shown) {
    return {
      title: <>{repo} {fallback.state === "preparing" ? "isn't shown yet" : "is left out"}</>,
      line: <>Its latest scan {fallbackStates[fallback.state]}.{again}</>,
    };
  }
  return {
    title: ownPage ? <>The latest scan {fallbackStates[fallback.state]}</> : <>{repo}'s latest scan {fallbackStates[fallback.state]}</>,
    line: (
      <>
        Showing <span className="font-mono">{shortCommit(fallback.shown.commit)}</span>, committed{" "}
        <span title={formatAbsoluteUtc(fallback.shown.committedAt)}>{relativeTime(fallback.shown.committedAt)}</span>.{again}
      </>
    ),
  };
}

function FallbackRow({ fallback, ownPage }: { fallback: ScanFallbackNotice; ownPage: boolean }) {
  const { title, line } = fallbackRow(fallback, ownPage);
  const failed = fallback.state !== "preparing";
  return <StatusBand failed={failed} role={failed ? undefined : "status"} title={title} line={line}
    link={fallback.state === "failed" ? retryGuide : null} />;
}

/** Repo rows shown before the rest fold into a disclosure. */
const SHOWN_ROWS = 3;

const gapLines: Record<SkippedState, [string, string]> = {
  preparing: ["It's being prepared.", "They're being prepared."],
  failed: ["It couldn't be prepared.", "They couldn't be prepared."],
  degraded: ["It can't be read. Scan this commit again to replace it.", "They can't be read. Scan these commits again to replace them."],
};

/**
 * What a page says about the scans it couldn't show: one row per repo shown at an older scan or left out (`ownPage`
 * leaves out the repo's name), and one band per state for scans left out of a chart's history. Preparing rows
 * re-check the page, or `refresh`.
 */
export function SkippedScansNotice({ fallbacks = [], gaps = [], ownPage = false, refresh }: {
  fallbacks?: ScanFallbackNotice[]; gaps?: ScanGapNotice[]; ownPage?: boolean;
  /** Re-checks a client-side request while preparing, in place of re-rendering the page. */
  refresh?: () => void;
}) {
  if (!fallbacks.length && !gaps.length) return null;
  const order = ["failed", "degraded", "preparing"] as const;
  const states = order.filter(state => gaps.some(gap => gap.state === state));
  const rows = order.flatMap(state => fallbacks.filter(fallback => fallback.state === state));
  const preparing = fallbacks.some(fallback => fallback.state === "preparing") || gaps.some(gap => gap.state === "preparing");
  return (
    <div className="space-y-2">
      {rows.slice(0, SHOWN_ROWS).map(fallback => <FallbackRow key={fallback.repoId} fallback={fallback} ownPage={ownPage} />)}
      {rows.length > SHOWN_ROWS ? (
        <details>
          <summary className="w-fit cursor-pointer rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            {rows.length - SHOWN_ROWS === 1 ? "1 more repo" : `${rows.length - SHOWN_ROWS} more repos`}
          </summary>
          <div className="mt-2 space-y-2">
            {rows.slice(SHOWN_ROWS).map(fallback => <FallbackRow key={fallback.repoId} fallback={fallback} ownPage={ownPage} />)}
          </div>
        </details>
      ) : null}
      {states.map(state => {
        const scans = gaps.filter(gap => gap.state === state);
        const failed = state !== "preparing";
        return <StatusBand key={state} failed={failed} role={failed ? undefined : "status"}
          title={scans.length === 1 ? "1 scan is left out" : `${scans.length} scans are left out`}
          line={gapLines[state][scans.length === 1 ? 0 : 1]} list={<ScanList scans={scans} />}
          link={state === "failed" ? retryGuide : null} />;
      })}
      {!preparing ? null : refresh ? <RecheckWhilePreparing check={refresh} /> : <RefreshPageWhilePreparing />}
    </div>
  );
}

export function ReadModelState({ state, scans, retryable, heading, embedded = false, besideNumbers = false, refresh }: Props) {
  const failed = state !== "preparing";
  const Icon = failed ? CircleX : Clock;
  const title = besideNumbers && failed ? "Numbers may be out of date" : readModelTitle(state);
  const text = message(state, scans, embedded, besideNumbers);
  const retryLink = state === "failed" && !besideNumbers ? retryGuide : null;
  const poll = state !== "preparing" || !retryable ? null
    : refresh ? <RecheckWhilePreparing check={refresh} /> : <RefreshPageWhilePreparing />;

  if (embedded) {
    return (
      // The chart builder shows a failure after the reader changes something, so it is announced there.
      <StatusBand failed={failed} role={failed ? (refresh ? "alert" : undefined) : "status"} title={title} line={text}
        list={scans.length ? <ScanList scans={scans} /> : null} link={retryLink} poll={poll} />
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      {heading ? (
        <header className="space-y-2">
          {heading.back ? (
            <Link
              href={heading.back.href}
              className={cn("inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50", heading.back.code && "font-mono")}
            >
              <ChevronLeft aria-hidden className="size-3" />
              {heading.back.label}
            </Link>
          ) : null}
          <h1 className={cn(heading.back ? "text-2xl" : "text-3xl", "font-semibold tracking-tight", heading.code && "font-mono")}>
            {heading.title}
          </h1>
        </header>
      ) : null}
      <div role={failed ? undefined : "status"}>
        <EmptyState
          icon={<Icon aria-hidden className={cn("size-6", failed && "text-status-err")} />}
          title={title}
          titleAs={heading ? "h2" : "h1"}
          description={text}
          action={scans.length || retryLink ? (
            <div className="space-y-3 text-sm">
              {scans.length ? (
                <ul className="space-y-1 font-mono text-xs text-muted-foreground">
                  {scans.map(scan => <li key={scan.scanId} className="break-all">{scanLabel(scan)}</li>)}
                </ul>
              ) : null}
              {retryLink}
            </div>
          ) : undefined}
        />
      </div>
      {poll}
    </div>
  );
}

/** The notice in place of, or beside, stored chart results. */
export function ChartResultsState({ notice, besideNumbers }: { notice: ChartResultsNotice; besideNumbers: boolean }) {
  return (
    <div className="space-y-2">
      {notice.unavailable ? <ReadModelState {...notice.unavailable} embedded besideNumbers={besideNumbers} /> : null}
      <SkippedScansNotice fallbacks={notice.fallbacks} />
    </div>
  );
}
