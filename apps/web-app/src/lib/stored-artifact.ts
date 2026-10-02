import type { PoolClient } from "pg";
import { SCHEMA_VERSION, schemaVersionOf, type ScanArtifact } from "@scoutui/scan-format";
import { readArchive } from "./scan-archive.ts";
import { scanUploadConfig } from "./scan-upload-config.ts";
import { decodeJson, ScanValidationError, type ScanValidationCode } from "./scan-validation.ts";

export type Decoded =
  | { version: typeof SCHEMA_VERSION; artifact: ScanArtifact }
  | { unknown: true; version: number | "invalid"; reason: "unsupported_version" | "invalid_artifact" | ScanValidationCode };

/** Reads the canonical bytes and version only; stored scan files have already been validated at ingest. */
export async function decodeCanonicalSource(
  client: PoolClient, source: { scanId: string } | { uploadId: string }, maxDecodedBytes: number,
): Promise<Decoded | null> {
  try {
    let uploadId: string | null;
    if ("uploadId" in source) {
      uploadId = source.uploadId;
    } else {
      const { rows: [scan] } = await client.query<{ source_upload_id: string | null }>(
        "SELECT source_upload_id FROM scans WHERE scan_id = $1", [source.scanId]);
      if (!scan) return null;
      uploadId = scan.source_upload_id;
    }
    let value: unknown;
    if (uploadId) {
      value = await decodeJson(readArchive(client, uploadId), maxDecodedBytes);
    } else if ("scanId" in source) {
      const { rows: [size] } = await client.query<{ bytes: number | null }>(
        "SELECT octet_length(artifact::text) AS bytes FROM scans WHERE scan_id = $1 AND source_upload_id IS NULL", [source.scanId]);
      if (!size) return null;
      if (size.bytes === null) return { unknown: true, version: "invalid", reason: "invalid_artifact" };
      if (size.bytes > maxDecodedBytes) throw new ScanValidationError("decoded_limit");
      const { rows: [stored] } = await client.query<{ text: string }>(
        "SELECT artifact::text AS text FROM scans WHERE scan_id = $1 AND source_upload_id IS NULL", [source.scanId]);
      if (!stored) return null;
      value = JSON.parse(stored.text);
    }
    const meta = typeof value === "object" && value !== null && "meta" in value ? value.meta : undefined;
    const version = schemaVersionOf(meta);
    if (version === "invalid") return { unknown: true, version, reason: "invalid_artifact" };
    return version === SCHEMA_VERSION ? { version, artifact: value as ScanArtifact } : { unknown: true, version, reason: "unsupported_version" };
  } catch (error) {
    if (error instanceof ScanValidationError) return { unknown: true, version: "invalid", reason: error.code };
    throw error;
  }
}

export type StoredRead = { artifact: ScanArtifact } | { degraded: true; reason: ScanValidationCode };

export async function readStoredArtifact(client: PoolClient, scanId: string): Promise<StoredRead | null> {
  const decoded = await decodeCanonicalSource(client, { scanId }, scanUploadConfig().maxDecodedBytes);
  if (!decoded) return null;
  return "unknown" in decoded ? { degraded: true, reason: decoded.reason } : { artifact: decoded.artifact };
}
