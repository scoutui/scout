import {
  componentKey,
  validateArtifact,
  type Component,
  type Identity,
  type Occurrence,
  type ScanArtifact,
  type UnresolvedReason,
} from "@scoutui/scan-format";
import type { StoredScanMeta } from "../../src/read-models.js";

export function packageExport(packageName: string, exportName: string, publicEntry = ""): Identity {
  return { kind: "package-export", packageName, publicEntry, exportName };
}

export function repoDeclaration(repoId: string, filePath: string, exportName: string): Identity {
  return { kind: "repository-declaration", repoId, filePath, exportName };
}

export function tag(tagName: string): Identity {
  return { kind: "tag", tagName };
}

export function component(identity: Identity, over: Partial<Component> = {}): Component {
  return {
    id: componentKey(identity),
    identity,
    ...(identity.kind === "tag" ? {} : { framework: "react" as const }),
    stats: { occurrenceCount: 0, fileCount: 0 },
    usage: "none",
    props: {},
    composition: { rendersByCount: {}, renderedByCount: {}, isRootCount: 0, isLeafCount: 0 },
    version: null,
    ...over,
  };
}

export function resolvedAt(c: Component, filePath: string, line = 1, over: Partial<Occurrence> = {}): Occurrence {
  return {
    occurrenceId: `${c.id}:${filePath}:${line}`,
    resolution: { status: "resolved", componentId: c.id },
    filePath,
    line,
    column: 1,
    credit: { kind: "render" },
    trace: [],
    props: {},
    ...over,
  };
}

export function unresolvedAt(reason: UnresolvedReason, filePath: string, line = 1): Occurrence {
  return {
    occurrenceId: `unresolved:${filePath}:${line}`,
    resolution: { status: "unresolved", reason },
    filePath,
    line,
    column: 1,
    credit: { kind: "render" },
    trace: [],
    props: {},
  };
}

export function artifact(parts: {
  scanId?: string;
  repoId?: string;
  scannedAt?: string;
  components: Component[];
  occurrences: Occurrence[];
}): ScanArtifact {
  const sites = new Map<string, { count: number; files: Set<string> }>();
  for (const occurrence of parts.occurrences) {
    if (occurrence.resolution.status !== "resolved") continue;
    const entry = sites.get(occurrence.resolution.componentId) ?? { count: 0, files: new Set<string>() };
    entry.count += 1;
    entry.files.add(occurrence.filePath);
    sites.set(occurrence.resolution.componentId, entry);
  }
  const components = parts.components.map((item) => {
    const entry = sites.get(item.id);
    const occurrenceCount = entry?.count ?? 0;
    return {
      ...item,
      stats: { occurrenceCount, fileCount: entry?.files.size ?? 0 },
      usage: occurrenceCount === 0 ? "none" as const : item.usage === "none" ? "direct" as const : item.usage,
    };
  });
  const scannedAt = parts.scannedAt ?? "2026-01-01T00:00:00Z";
  const result: ScanArtifact = {
    meta: {
      schemaVersion: 2,
      scannerVersion: "0.0.0-test",
      scanId: parts.scanId ?? "test-scan",
      scannedAt,
      repo: { id: parts.repoId ?? "test-repo", gitRemote: null, commit: "test-commit", committedAt: scannedAt, initialCommit: null, branch: null },
    },
    components,
    occurrences: parts.occurrences,
    diagnostics: [],
  };
  const validation = validateArtifact(result);
  if (!validation.ok) throw new Error(`Invalid test artifact: ${JSON.stringify(validation)}`);
  return result;
}

/** A built scan as the dashboard reads it back: its commit date in place of `scannedAt`, received at `arrivedAt` (by default its commit date). */
export function received(scan: ScanArtifact, arrivedAt = scan.meta.repo.committedAt): Omit<ScanArtifact, "meta"> & { meta: StoredScanMeta } {
  const { scannedAt: _scannedAt, ...meta } = scan.meta;
  return { ...scan, meta: { ...meta, committedAt: scan.meta.repo.committedAt, arrivedAt } };
}
