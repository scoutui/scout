import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ScanArtifact } from "@scoutui/scan-format";

/**
 * Writes the scan artefact to disk as pretty-printed JSON.
 * Creates parent directories as needed.
 */
export async function writeJson(output: ScanArtifact, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}
