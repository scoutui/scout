/** Ascending version order (`1.5.0` before `1.14.11`) through a numeric-aware
 *  locale compare. Every surface sorts versions with it, so the repo components
 *  table and the version bars agree. */
export function compareVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}
