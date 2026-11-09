import { compareCliVersions } from "@scoutui/scan-format/cli-version";
import type { VersionRange } from "@scoutui/web-shared";
import type { SortDir } from "@/components/ui/sortable";

/** Ascending version order by SemVer precedence (`1.5.0` before `1.14.11`, `5.0.0-rc.1` before `5.0.0`). Every surface
 *  sorts versions with it, so the tables and the version ranges agree. */
export function compareVersions(a: string, b: string): number {
  return compareCliVersions(a, b);
}

/** Rows sorted by `version` in SemVer order: `sortRows` compares strings as
 *  text, which puts `1.14.11` before `1.5.0`. Nulls last in both directions,
 *  as in `sortRows`. */
export function sortByVersion<T extends { version: string | null }>(rows: readonly T[], dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a.version;
    const bv = b.version;
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return compareVersions(av, bv) * sign;
  });
}

/** `1.2.0` for one version, `1.2.0 – 4.1.3` for several, null for none. */
export function versionRangeLabel(range: VersionRange): string | null {
  if (range === null) return null;
  return range.oldest === range.newest ? range.oldest : `${range.oldest} – ${range.newest}`;
}
