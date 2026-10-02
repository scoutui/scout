/** The scan fields that order usages of one component id. */
type ScanStamp = { committedAt: string; repo: { id: string } };

/**
 * The usage that speaks for a component id seen in several scans: the one from the latest scan,
 * the lower repo id between scans taken at the same time. Null when there are no usages.
 * Every cross-scan view takes a component's presentation from it.
 */
export function representativeUsage<U extends { meta: ScanStamp }>(usages: Iterable<U>): U | null {
  let best: U | null = null;
  for (const usage of usages) {
    if (best === null || usage.meta.committedAt > best.meta.committedAt
      || (usage.meta.committedAt === best.meta.committedAt && usage.meta.repo.id < best.meta.repo.id)) best = usage;
  }
  return best;
}
