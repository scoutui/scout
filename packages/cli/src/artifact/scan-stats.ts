import { type Occurrence, resolvedOccurrences } from "@scoutui/scan-format";

/** A scan's summary counts. The scan file doesn't carry them. */
export type ScanStats = {
  filesScanned: number;
  scanDurationMs: number;
  componentCount: number;
  occurrenceCount: number;
  resolvedOccurrenceCount: number;
};

export function buildScanStats(input: {
  filesScanned: number; scanDurationMs: number;
  components: readonly unknown[]; occurrences: readonly Occurrence[];
}): ScanStats {
  return {
    filesScanned: input.filesScanned,
    scanDurationMs: input.scanDurationMs,
    componentCount: input.components.length,
    occurrenceCount: input.occurrences.length,
    resolvedOccurrenceCount: resolvedOccurrences(input.occurrences).length,
  };
}
