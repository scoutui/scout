/** A scan a page can't show, with the repo and commit a person can act on. */
export type UnavailableScan = { scanId: string; repoId: string; commit: string };

/** `scans` lists the failed or unreadable scans; it is empty while scans are preparing. */
export type ReadModelUnavailable = {
  state: "preparing" | "failed" | "degraded";
  scans: UnavailableScan[];
  retryable: boolean;
};

/** Why a scan that isn't ready can't be shown. */
export type SkippedState = ReadModelUnavailable["state"];

/**
 * A repo whose newest scan isn't ready: `latest` is that scan, and `shown` the newest ready scan the page shows in its
 * place, or null when the page leaves the repo out.
 */
export type ScanFallbackNotice = {
  repoId: string;
  state: SkippedState;
  latest: UnavailableScan;
  shown: { commit: string; committedAt: string } | null;
};

/** A scan that isn't ready, left out of a chart's history. */
export type ScanGapNotice = UnavailableScan & { state: SkippedState };

export type SkippedNotices = { fallbacks: ScanFallbackNotice[]; gaps: ScanGapNotice[] };

/** What a stored-results surface shows: an unavailable state, and the repos whose newest scan failed or can't be read. */
export type ChartResultsNotice = { unavailable: ReadModelUnavailable | null; fallbacks: ScanFallbackNotice[] };

export type ReadModelResult<T> = ({ state: "ready"; value: T } & SkippedNotices) | ReadModelUnavailable;

export function readModelTitle(state: ReadModelUnavailable["state"]): string {
  if (state === "degraded") return "Scan data can't be read";
  return state === "preparing" ? "Preparing scan data" : "Scan data couldn't be prepared";
}
