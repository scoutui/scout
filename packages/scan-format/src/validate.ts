import { artifactSchema, isPlainObject, type ScanArtifact } from "./schema.js";
import { SCHEMA_VERSION, schemaVersionOf } from "./schema-version.js";

export type ValidationResult =
  | { ok: true; artifact: ScanArtifact }
  | { ok: false; reason: "unsupported_version"; version: number | "invalid" }
  | { ok: false; reason: "invalid_artifact"; path: string };

/** Formats an issue path as `a.b[0].c`: an index as `[n]`, a key as `.key`, with no leading dot. */
function formatPath(path: readonly (string | number)[]): string {
  return path.map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${segment}`)).join("").replace(/^\./, "");
}

/**
 * Checks a parsed artefact against the scan file's contract: the schema version first, then the first failing JSON path.
 * A valid artefact is returned as the input object itself, unknown keys included.
 */
export function validateArtifact(value: unknown): ValidationResult {
  const version = schemaVersionOf(isPlainObject(value) && "meta" in value ? value.meta : undefined);
  if (version !== SCHEMA_VERSION) return { ok: false, reason: "unsupported_version", version };
  const result = artifactSchema.safeParse(value);
  if (result.success) return { ok: true, artifact: value as ScanArtifact };
  return { ok: false, reason: "invalid_artifact", path: formatPath(result.error.issues[0]?.path ?? []) };
}
