import { gzipSync } from "node:zlib";
import type { Pool } from "pg";
import type { ScanArtifact } from "@scoutui/scan-format";
import { receiveUpload } from "@/lib/scan-archive";
import { artifact, component, packageExport, resolvedAt } from "../../../../packages/web-shared/tests/helpers/builders.js";

export function sampleArtifact(
  { scanId = "scan-a", scannedAt = "2026-09-19T00:00:00Z", repoId = "repo-a", commit, scannerName = "@scoutui/cli" }:
    { scanId?: string; scannedAt?: string; repoId?: string; commit?: string; scannerName?: string | null } = {},
): ScanArtifact {
  const button = component(packageExport("@sample/core", "Button"), {
    stats: { occurrenceCount: 1, fileCount: 1 },
    usage: "direct",
    composition: { rendersByCount: {}, renderedByCount: {}, isRootCount: 1, isLeafCount: 1 },
  });
  const scan = artifact({
    scanId, scannedAt, repoId,
    components: [button],
    occurrences: [resolvedAt(button, "src/view.tsx", 1, {
      occurrenceId: "call", column: 2,
      trace: [{ kind: "import", specifier: "@sample/core", name: "Button" }],
    })],
  });
  if (scannerName !== null) scan.meta.scannerName = scannerName;
  scan.meta.repo.commit = commit ?? `commit-${scanId}`;
  return scan;
}

export async function receiveArtifact(pool: Pool, value: unknown, options: { rescan?: boolean } = {}): Promise<string> {
  const bytes = Buffer.isBuffer(value) ? value : gzipSync(Buffer.from(JSON.stringify(value)));
  async function* body() { yield bytes; }
  const limits = { maxWireBytes: 16 * 1024 * 1024, maxStoredBytes: 16 * 1024 * 1024, timeoutMs: 10_000 };
  return (await receiveUpload(pool, body(), "gzip", null, limits, new AbortController().signal, options)).uploadId;
}
