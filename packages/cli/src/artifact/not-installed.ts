import { isKind, type Occurrence } from "@scoutui/scan-format";

/** Occurrence count of each declared package that is not installed, in package-name order. */
export function packagesNotInstalled(occurrences: readonly Occurrence[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { resolution } of occurrences) {
    if (resolution.status !== "unresolved" || !isKind(resolution.reason, "package-not-installed")) continue;
    const { packageName } = resolution.reason;
    counts.set(packageName, (counts.get(packageName) ?? 0) + 1);
  }
  return new Map([...counts].sort(([a], [b]) => a.localeCompare(b)));
}
