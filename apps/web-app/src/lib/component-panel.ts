import { presentIdentity, topProps, type StorageDriver, type TopProp } from "@scoutui/web-shared";

/**
 * What the repo page's details panel reads for one component of one scan, beyond its table row. It reads only this
 * repo's scans; the other repos that use the component come from one read for the whole scan, which reads every repo's.
 */
export type ComponentPanelFacts = {
  /** Where a component defined in the repo is declared; the line only where the scan keeps it. */
  source: { filePath: string; line: number | null } | null;
  /** The most set props; `kept` is false for a scan that doesn't keep prop values (only a repo's latest scan does). */
  props: { kept: true; uses: number; top: TopProp[]; neverSet: number | null } | { kept: false };
};

/** The panel's facts for `componentId` in the repo's scan `scanId`, or null when that scan doesn't hold it. */
export async function componentPanelFacts(snapshot: StorageDriver, repoId: string, scanId: string, componentId: string): Promise<ComponentPanelFacts | null> {
  const digest = (await snapshot.listScanDigests(repoId, { componentIds: [componentId] }))
    .find((scan) => scan.meta.scanId === scanId)?.components[0];
  if (!digest) return null;
  const head = await snapshot.getComponentDetailHead(repoId, componentId, scanId);
  const { filePath } = presentIdentity(digest);
  const uses = head?.summary.footprint.callCount ?? 0;
  return {
    source: filePath === null ? null : { filePath, line: head?.definedAt?.filePath === filePath ? head.definedAt.line : null },
    props: head ? { kept: true, uses, ...topProps(head, uses) } : { kept: false },
  };
}
