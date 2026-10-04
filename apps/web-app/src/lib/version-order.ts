import { compareCliVersions } from "@scoutui/scan-format/cli-version";

/** Ascending version order by SemVer precedence (`1.5.0` before `1.14.11`, `5.0.0-rc.1` before `5.0.0`). Every surface
 *  sorts versions with it, so the repo components table and the version bars agree. */
export function compareVersions(a: string, b: string): number {
  return compareCliVersions(a, b);
}
