import type { ScanArtifact } from "@scoutui/scan-format";
import { nameOf, sourceOf } from "./stdout.js";

/** `value` as one CSV field: quoted when it holds a comma, a quote or a line break, with quotes doubled. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Every component in the scan as CSV, one row each, most used first: its name as the dashboard shows it, where it comes
 * from (its package, or the file that declares it), the installed version, and its occurrences and the files they're in.
 */
export function componentsCsv(artifact: ScanArtifact): string {
  const rows = [...artifact.components]
    .sort((a, b) => b.stats.occurrenceCount - a.stats.occurrenceCount || nameOf(a).localeCompare(nameOf(b)) || sourceOf(a).localeCompare(sourceOf(b)))
    .map((c) => [nameOf(c), sourceOf(c), c.version ?? "", String(c.stats.occurrenceCount), String(c.stats.fileCount)]);
  return [["component", "source", "version", "occurrences", "files"], ...rows].map((row) => `${row.map(csvField).join(",")}\n`).join("");
}
