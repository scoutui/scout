/**
 * Display length for scan ids. ULIDs encode a millisecond timestamp in their
 * first 10 characters, so scans close in time on the same machine can share
 * their first 8 to 12 characters. 12 keeps the label readable while reaching
 * past the timestamp into the random segment.
 */
const SHORT_SCAN_ID_LENGTH = 12;

/** Short display form of a scan id. Full ids belong in `title` attributes. */
export function shortScanId(scanId: string): string {
  return scanId.slice(0, SHORT_SCAN_ID_LENGTH);
}
