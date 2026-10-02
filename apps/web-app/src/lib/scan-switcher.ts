/** Display logic for the scan switcher and the older-scan banner. */

/**
 * Href for a scan row. The latest scan links to the bare repo URL (canonical,
 * no query) so refreshes track new scans; older scans pin an explicit
 * `?scan=` param. repoIds can contain "/" (monorepo per-app ids), hence the
 * encoding on both segments.
 */
export function scanHref(
  repoId: string,
  scanId: string,
  latestScanId: string | undefined,
): string {
  const base = `/repos/${encodeURIComponent(repoId)}`;
  return scanId === latestScanId
    ? base
    : `${base}?scan=${encodeURIComponent(scanId)}`;
}

/**
 * The popover's visible window of recent scans. When the current scan sits
 * outside the first `limit` entries, it is prepended (and the window keeps
 * its size) so the popover always reflects what's selected.
 */
export function recentScanWindow<T extends { scanId: string }>(
  recentScans: T[],
  currentScanId: string,
  limit: number,
): T[] {
  const window = recentScans.slice(0, limit);
  if (window.some((s) => s.scanId === currentScanId)) return window;
  const current = recentScans.filter((s) => s.scanId === currentScanId);
  return [...current, ...window.slice(0, limit - current.length)];
}

/** Footer count label: `1 scan` / `N scans`. */
export function scanCountLabel(totalScanCount: number): string {
  return `${totalScanCount.toLocaleString()} ${totalScanCount === 1 ? "scan" : "scans"}`;
}

/**
 * Whether the page is showing an explicitly requested scan that isn't the latest
 * (and should render the older-scan banner). `resolvedScanId` is the scan the
 * storage layer served; comparing the latest against it, not the raw query
 * param, keeps the banner off when the requested id is the latest.
 */
export function isOlderScan(
  requestedScanId: string | undefined,
  latestScanId: string | undefined,
  resolvedScanId: string,
): boolean {
  return (
    requestedScanId !== undefined &&
    latestScanId !== undefined &&
    latestScanId !== resolvedScanId
  );
}
