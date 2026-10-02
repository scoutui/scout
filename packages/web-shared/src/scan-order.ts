/** The scan fields that order one repository's scans. */
export type ScanOrderMeta = { scanId: string; committedAt: string; arrivedAt: string; repo: { branchPosition?: number | null | undefined } };

/**
 * Where a scan sits in its repository's history: its commit date (`committedAt`), or when the dashboard received it
 * (`arrivedAt`) if that is earlier, so a commit dated in the future sits at its arrival.
 */
export function scanOrderTime(meta: Pick<ScanOrderMeta, "committedAt" | "arrivedAt">): string {
  return Date.parse(meta.arrivedAt) < Date.parse(meta.committedAt) ? meta.arrivedAt : meta.committedAt;
}

/**
 * The order of one repository's scans, newest first: `scanOrderTime`, then the commit's position on the tracked
 * branch (an unknown position last), then the scan id. The first scan is the repository's latest.
 */
export function newestScanFirst(a: ScanOrderMeta, b: ScanOrderMeta): number {
  return Date.parse(scanOrderTime(b)) - Date.parse(scanOrderTime(a))
    || (b.repo.branchPosition ?? -1) - (a.repo.branchPosition ?? -1)
    || b.scanId.localeCompare(a.scanId);
}

function columns(alias: string | undefined): string {
  return alias ? `${alias}.` : "";
}

/** `newestScanFirst` as an `ORDER BY` list over the `scans` columns, qualified by `alias` when given. */
export function newestScanFirstSql(alias?: string): string {
  const c = columns(alias);
  return `LEAST(${c}committed_at, ${c}created_at) DESC, ${c}branch_position DESC NULLS LAST, ${c}scan_id DESC`;
}
