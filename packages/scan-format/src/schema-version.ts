/**
 * Version of the scan file's format. Raise it only when a dashboard that knows just the previous version would get a
 * scan in the new one wrong. CODING_STANDARDS.md, "Changing the scan format", lists what isn't a change and the release steps.
 */
export const SCHEMA_VERSION = 2 as const;

/** Absent → 1 (artefacts written before `schemaVersion` existed); positive integer → itself; anything else → "invalid". */
export function schemaVersionOf(meta: unknown): number | "invalid" {
  if (typeof meta !== "object" || meta === null) return "invalid";
  const v = (meta as { schemaVersion?: unknown }).schemaVersion;
  if (v === undefined) return 1;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : "invalid";
}
