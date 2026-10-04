import { readFileSync } from "node:fs";
import { validateArtifact, type ScanArtifact } from "@scoutui/scan-format";

/** A CLI integration baseline scan, read from `packages/cli/tests/integration/__baselines__/current/<name>.json` and validated. */
export function baseline(name: string): ScanArtifact {
  const validated = validateArtifact(JSON.parse(readFileSync(new URL(`../../../../packages/cli/tests/integration/__baselines__/current/${name}.json`, import.meta.url), "utf8")));
  if (!validated.ok) throw new Error(`${name}.json is not a valid scan: ${validated.reason}`);
  return validated.artifact;
}
