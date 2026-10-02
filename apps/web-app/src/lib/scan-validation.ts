import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createGunzip } from "node:zlib";

const messages = {
  invalid_gzip: "Couldn't upload the scan: it arrived damaged. Try again.",
  decoded_limit: "Couldn't upload the scan: it's larger than this dashboard accepts. Ask your dashboard administrator to raise SCOUTUI_MAX_DECODED_ARTIFACT_BYTES.",
  invalid_json: "Couldn't upload the scan: it arrived damaged. Try again.",
  invalid_artifact: "Couldn't upload the scan: the dashboard can't read it. Ask your dashboard administrator to upgrade it, or report a bug.",
  unsupported_version: "Scan file version is not supported",
  archive_incomplete: "Couldn't upload the scan: it arrived incomplete. Try again.",
  identity_conflict: "Couldn't upload the scan: the dashboard already has a different scan with the same ID. Scan again to get a new ID.",
  scanned_with_newer_cli: "This commit was scanned with a newer CLI",
  unsupported_scanner: "Couldn't upload the scan: it comes from a CLI this dashboard no longer accepts. Install @scoutui/cli and scan again.",
  repo_remote_mismatch: "Couldn't upload the scan: this repository name on the dashboard comes from a different remote.",
} as const;

export type ScanValidationCode = keyof typeof messages;

/** The default message for a rejection code. */
export function scanValidationMessage(code: ScanValidationCode): string {
  return messages[code];
}

/** A permanent rejection of stored scan input. */
export class ScanValidationError extends Error {
  readonly code: ScanValidationCode;
  /** Where in the scan reading failed, for the worker's log. */
  readonly path: string | undefined;
  constructor(code: ScanValidationCode, message?: string, path?: string) {
    super(message ?? scanValidationMessage(code));
    this.name = "ScanValidationError";
    this.code = code;
    this.path = path;
  }
}

function isZlibError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("Z_");
}

/** Decodes bounded gzip JSON without validating an artifact schema. */
export async function decodeJson(input: AsyncIterable<Uint8Array>, maxDecodedBytes: number): Promise<unknown> {
  const gunzip = createGunzip();
  const source = Readable.from(input, { objectMode: false });
  source.on("error", error => gunzip.destroy(error));
  source.pipe(gunzip);
  const decoder = new StringDecoder("utf8");
  let parts: string[] = [];
  let decodedBytes = 0;
  try {
    for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      decodedBytes += chunk.byteLength;
      if (decodedBytes > maxDecodedBytes) throw new ScanValidationError("decoded_limit");
      parts.push(decoder.write(chunk));
    }
  } catch (error) {
    if (isZlibError(error)) throw new ScanValidationError("invalid_gzip");
    throw error;
  } finally {
    source.destroy();
    gunzip.destroy();
  }
  parts.push(decoder.end());
  const text = parts.join("");
  parts = [];
  try {
    return JSON.parse(text);
  } catch {
    throw new ScanValidationError("invalid_json");
  }
}
