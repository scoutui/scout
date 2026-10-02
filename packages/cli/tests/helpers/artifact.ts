import { validateArtifact, type ScanArtifact } from "@scoutui/scan-format";
import type { Diagnostic } from "../../src/diagnostic.js";

/** Returns `value` as a scan file, or throws naming the first path the validator rejects. */
export function assertValidArtifact(value: unknown): ScanArtifact<Diagnostic> {
  const result = validateArtifact(value);
  if (result.ok) return result.artifact as ScanArtifact<Diagnostic>;
  if (result.reason === "unsupported_version") throw new Error(`unsupported scan file version: schemaVersion ${result.version}`);
  throw new Error(`invalid scan file at ${result.path}`);
}
