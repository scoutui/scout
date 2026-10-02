/**
 * Grouping and search for the governance identity picker. The caps stop a large
 * package (an icon package with 160 exports) flooding the list, and the hidden
 * counts are reported so the UI can say what was dropped.
 */

export type IdentityGroup = { packageName: string; exports: string[] };
export type FilteredGroup = { packageName: string; exports: string[]; hiddenExports: number; totalExports: number };
export type FilteredIdentityGroups = { groups: FilteredGroup[]; hiddenGroups: number };

export const MAX_GROUPS = 12;
export const MAX_EXPORTS_PER_GROUP = 10;

/** Ever-scanned sources → package-sorted groups with sorted, de-duplicated exports. */
export function buildIdentityGroups(sources: { packageName: string; exportName?: string }[]): IdentityGroup[] {
  const byPkg = new Map<string, Set<string>>();
  for (const s of sources) {
    const set = byPkg.get(s.packageName) ?? new Set<string>();
    if (s.exportName) set.add(s.exportName);
    byPkg.set(s.packageName, set);
  }
  return [...byPkg.entries()]
    .map(([packageName, exports]) => ({ packageName, exports: [...exports].sort() }))
    .sort((a, b) => a.packageName.localeCompare(b.packageName));
}

/**
 * Tokenised AND search: every whitespace-separated term must match the package
 * name or the export name (case-insensitive substring), so `ui button` and
 * `button ui` are the same query. When all terms match the package name the
 * whole group shows; otherwise only exports where every term matches (through
 * the package or the export) stay.
 */
export function filterIdentityGroups(groups: IdentityGroup[], query: string): FilteredIdentityGroups {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matched = terms.length === 0
    ? groups
    : groups.flatMap((g) => {
        const pkgLower = g.packageName.toLowerCase();
        const pkgMatches = terms.every((t) => pkgLower.includes(t));
        const exports = pkgMatches
          ? g.exports
          : g.exports.filter((e) => terms.every((t) => pkgLower.includes(t) || e.toLowerCase().includes(t)));
        if (!pkgMatches && exports.length === 0) return [];
        return [{ packageName: g.packageName, exports }];
      });

  const shown = matched.slice(0, MAX_GROUPS).map((g) => ({
    packageName: g.packageName,
    exports: g.exports.slice(0, MAX_EXPORTS_PER_GROUP),
    hiddenExports: Math.max(0, g.exports.length - MAX_EXPORTS_PER_GROUP),
    totalExports: g.exports.length,
  }));
  return { groups: shown, hiddenGroups: matched.length - shown.length };
}
