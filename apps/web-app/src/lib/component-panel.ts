import { presentIdentity, scanOrderTime, topProps, type DigestScan, type ScanSummary, type StorageDriver, type TopProp } from "@scoutui/web-shared";

/** A component's uses in one scan, at the scan's place in the repo's history. */
export type HistoryPoint = { t: string; value: number };

/**
 * What the repo page's details panel reads for one component of one scan, beyond its table row. It reads only this
 * repo's scans; the other repos that use the component come from one read for the whole scan, which reads every repo's.
 */
export type ComponentPanelFacts = {
  /** Where a component defined in the repo is declared; the line only where the scan keeps it. */
  source: { filePath: string; line: number | null } | null;
  /** The most set props; `kept` is false for a scan that doesn't keep prop values (only a repo's latest scan does). */
  props: { kept: true; uses: number; top: TopProp[]; neverSet: number | null } | { kept: false };
  /** The component's uses in each ready scan from the first holding it to this one, oldest first (`componentHistory`). */
  history: HistoryPoint[];
};

/** The panel's facts for `componentId` in the repo's scan `scanId`, or null when that scan doesn't hold it. */
export async function componentPanelFacts(snapshot: StorageDriver, repoId: string, scanId: string, componentId: string): Promise<ComponentPanelFacts | null> {
  const digests = await snapshot.listScanDigests(repoId, { componentIds: [componentId] });
  const digest = digests.find((scan) => scan.meta.scanId === scanId)?.components[0];
  if (!digest) return null;
  const head = await snapshot.getComponentDetailHead(repoId, componentId, scanId);
  const { filePath } = presentIdentity(digest);
  const uses = head?.summary.footprint.callCount ?? 0;
  return {
    source: filePath === null ? null : { filePath, line: head?.definedAt?.filePath === filePath ? head.definedAt.line : null },
    props: head ? { kept: true, uses, ...topProps(head, uses) } : { kept: false },
    history: componentHistory(await snapshot.listScans(repoId), digests, scanId),
  };
}

/**
 * A component's uses in each ready scan of a repo, oldest first, from the first scan holding it to `scanId`; a scan
 * between that doesn't hold it counts 0. `scans` are the repo's scans newest first, as `listScans` gives them, and
 * `digests` the scans holding the component, with its digest. Each point sits at the scan's `scanOrderTime`.
 */
export function componentHistory(scans: ScanSummary[], digests: DigestScan[], scanId: string): HistoryPoint[] {
  const uses = new Map(digests.map((scan) => [scan.meta.scanId, scan.components[0]?.stats.occurrenceCount ?? 0]));
  const ready = scans.filter((scan) => scan.ready).reverse();
  const first = ready.findIndex((scan) => uses.has(scan.scanId));
  const shown = ready.findIndex((scan) => scan.scanId === scanId);
  if (first < 0 || shown < first) return [];
  return ready.slice(first, shown + 1).map((scan) => ({ t: scanOrderTime(scan), value: uses.get(scan.scanId) ?? 0 }));
}
