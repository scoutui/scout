import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createGzip, type Gzip } from "node:zlib";
import type { Pool, PoolClient } from "pg";
import { PROJECTION_VERSION } from "@scoutui/web-shared";
import { SCAN_JOB_PRIORITY, UPLOAD_QUEUE_LOCK_KEY, uploadQueueFull } from "./scan-jobs.ts";
import { ScanValidationError } from "./scan-validation.ts";

const CHUNK_BYTES = 1024 * 1024;
export type ReceiveLimits = { maxWireBytes: number; maxStoredBytes: number; timeoutMs: number; maxQueuedUploads?: number | null };
export class UploadReceiveError extends Error {
  readonly code: "wire_limit" | "stored_limit" | "timeout" | "aborted" | "queue_full";
  constructor(code: UploadReceiveError["code"]) {
    super({ wire_limit: "Upload exceeds the wire byte limit", stored_limit: "Upload exceeds the stored byte limit",
      timeout: "Upload reception timed out", aborted: "Upload reception was cancelled", queue_full: "Upload queue is full" }[code]);
    this.name = "UploadReceiveError";
    this.code = code;
  }
}

export async function receiveUpload(
  pool: Pool, input: AsyncIterable<Uint8Array>, encoding: "gzip" | "identity",
  uploadedByUserId: string | null, limits: ReceiveLimits, signal: AbortSignal, options: { rescan?: boolean } = {},
): Promise<{ uploadId: string }> {
  for (const value of Object.values(limits)) {
    if (value !== null && value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error("Upload limits must be positive safe integers");
  }
  const inputIterator = input[Symbol.asyncIterator]();
  let client: PoolClient | undefined;
  let released = false;
  let committed = false;
  let cancelled: UploadReceiveError | undefined;
  let rejectAbort: (error: UploadReceiveError) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  void aborted.catch(() => {});
  function cancel(code: "timeout" | "aborted") {
    if (cancelled) return;
    cancelled = new UploadReceiveError(code);
    if (client && !released) { released = true; client.release(true); }
    rejectAbort(cancelled);
  }
  const onAbort = () => cancel("aborted");
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => cancel("timeout"), limits.timeoutMs);
  const race = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, aborted]);
  let source: Readable | undefined;
  let gzip: Gzip | undefined;
  try {
    if (signal.aborted) cancel("aborted");
    if (cancelled) throw cancelled;
    client = await race<PoolClient>(pool.connect().then((connection) => {
      if (cancelled) { connection.release(true); throw cancelled; }
      return connection;
    }));
    await race(client.query("BEGIN"));
    const uploadId = randomUUID();
    await race(client.query("INSERT INTO scan_uploads (upload_id, uploaded_by_user_id, encoding) VALUES ($1, $2, 'gzip')", [uploadId, uploadedByUserId]));
    async function* wire() {
      let wireBytes = 0;
      for (;;) {
        const next = await inputIterator.next();
        if (next.done) return;
        const bytes = next.value;
        wireBytes += bytes.byteLength;
        if (wireBytes > limits.maxWireBytes) throw new UploadReceiveError("wire_limit");
        for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
          yield bytes.subarray(offset, offset + CHUNK_BYTES);
        }
      }
    }
    source = Readable.from(wire(), { objectMode: false, highWaterMark: CHUNK_BYTES });
    let stored: AsyncIterable<Uint8Array> = source;
    if (encoding === "identity") {
      gzip = createGzip();
      const compressor = gzip;
      source.on("error", (error) => compressor.destroy(error));
      stored = source.pipe(gzip);
    }
    const hash = createHash("sha256");
    let storedBytes = 0;
    let ordinal = 0;
    const iterator = stored[Symbol.asyncIterator]();
    for (;;) {
      const next = await race(iterator.next());
      if (next.done) break;
      const bytes = next.value;
      storedBytes += bytes.byteLength;
      if (storedBytes > limits.maxStoredBytes) throw new UploadReceiveError("stored_limit");
      hash.update(bytes);
      for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
        const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
        await race(client.query("INSERT INTO scan_artifact_chunks (upload_id, ordinal, bytes) VALUES ($1, $2, $3)", [uploadId, ordinal++, chunk]));
      }
    }
    if (limits.maxQueuedUploads) {
      await race(client.query("SELECT pg_advisory_xact_lock($1)", [UPLOAD_QUEUE_LOCK_KEY]));
      if (await race(uploadQueueFull(client, limits.maxQueuedUploads))) throw new UploadReceiveError("queue_full");
    }
    await race(client.query(`UPDATE scan_uploads SET state = 'queued', stored_bytes = $2, checksum = $3,
      received_at = now(), updated_at = now() WHERE upload_id = $1`, [uploadId, storedBytes, hash.digest("hex")]));
    await race(client.query("INSERT INTO scan_jobs (id, kind, upload_id, projection_version, priority, rescan) VALUES ($1, 'upload', $2, $3, $4, $5)",
      [randomUUID(), uploadId, PROJECTION_VERSION, SCAN_JOB_PRIORITY.upload, options.rescan === true]));
    await race(client.query("COMMIT"));
    committed = true;
    return { uploadId };
  } catch (error) {
    if (client && !released) await client.query("ROLLBACK").catch(() => {});
    throw cancelled ?? error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    if (!committed && inputIterator.return) {
      try { void Promise.resolve(inputIterator.return()).catch(() => {}); } catch {}
    }
    gzip?.destroy();
    source?.destroy();
    if (client && !released) { released = true; client.release(); }
  }
}

export async function* readArchive(client: PoolClient, uploadId: string): AsyncIterable<Uint8Array> {
  let ordinal = -1;
  for (;;) {
    const { rows } = await client.query<{ ordinal: number; bytes: Buffer }>(
      "SELECT ordinal, bytes FROM scan_artifact_chunks WHERE upload_id = $1 AND ordinal > $2 ORDER BY ordinal LIMIT 1",
      [uploadId, ordinal],
    );
    const row = rows[0];
    if (!row) return;
    if (row.ordinal !== ordinal + 1) throw new ScanValidationError("archive_incomplete");
    ordinal = row.ordinal;
    yield row.bytes;
  }
}
