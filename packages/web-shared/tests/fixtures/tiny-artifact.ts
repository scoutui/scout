import type { ScanArtifact } from "@scoutui/scan-format";
import { artifact, component, repoDeclaration, resolvedAt, tag } from "../helpers/builders.js";

/**
 * A small scan file for the database tests: one tag (`x-button`) rendered by
 * one repository component (`Card`). Each scan is its own commit unless
 * `commit` says otherwise.
 */
export function tinyArtifact(
  overrides: Partial<{
    repoId: string;
    scanId: string;
    scannedAt: string;
    commit: string;
    committedAt: string;
    branch: string | null;
  }> = {},
): ScanArtifact {
  const repoId = overrides.repoId ?? "tiny-repo";
  const scanId = overrides.scanId ?? "01HXXXXXXXXXXXXXXXXXXXXXXX";
  const scannedAt = overrides.scannedAt ?? "2026-05-18T12:00:00.000Z";
  const commit = overrides.commit ?? `commit-${scanId}`;
  const committedAt = overrides.committedAt ?? scannedAt;
  const branch = overrides.branch === undefined ? "main" : overrides.branch;
  const button = component(tag("x-button"), {
    attribution: { status: "resolved", target: { kind: "package", packageName: "@x/wc" }, confidence: "observed", evidence: [] },
    version: "1.0.0",
    stats: { occurrenceCount: 1, fileCount: 1 },
    usage: "direct",
    composition: { rendersByCount: {}, renderedByCount: {}, isRootCount: 0, isLeafCount: 1 },
  });
  const card = component(repoDeclaration(repoId, "src/Card.tsx", "Card"), {
    stats: { occurrenceCount: 1, fileCount: 1 },
    usage: "root",
    composition: { rendersByCount: { [button.id]: 1 }, renderedByCount: {}, isRootCount: 1, isLeafCount: 0 },
  });
  button.composition.renderedByCount[card.id] = 1;
  const scan = artifact({
    repoId, scanId, scannedAt,
    components: [button, card],
    occurrences: [
      resolvedAt(button, "src/App.tsx", 10, { occurrenceId: "occ-1", column: 4, ownerComponentId: card.id, trace: [{ kind: "tag", written: "x-button" }] }),
      resolvedAt(card, "src/App.tsx", 8, { occurrenceId: "occ-2", column: 2 }),
    ],
  });
  scan.meta.repo.commit = commit;
  scan.meta.repo.committedAt = committedAt;
  scan.meta.repo.branch = branch;
  return scan;
}
