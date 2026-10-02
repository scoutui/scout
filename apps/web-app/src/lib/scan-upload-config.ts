type Env = Record<string, string | undefined>;

const MiB = 1024 * 1024;
const MAX_TIMER_MS = 2_147_483_647;
const NODE_REQUEST_TIMEOUT_MS = 300_000;
const MAX_UPLOAD_WAIT_MS = NODE_REQUEST_TIMEOUT_MS - 30_000;

export type ScanUploadConfig = {
  maxWireBytes: number;
  maxStoredBytes: number;
  maxDecodedBytes: number;
  receiveTimeoutMs: number;
  receiveSlots: number;
  receiveSlotWaitMs: number;
  maxQueuedUploads: number | null;
};

export function positiveInteger(env: Env, key: string, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`${key} must be a positive integer at most ${max}`);
  }
  return value;
}

/** Upload limits shared by the web server and the worker. Throws on an invalid setting. */
export function readScanUploadConfig(env: Env): ScanUploadConfig {
  const maxWireBytes = positiveInteger(env, "SCOUTUI_MAX_UPLOAD_BYTES") ?? 42 * MiB;
  const receiveTimeoutMs = positiveInteger(env, "SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS", MAX_TIMER_MS) ?? 180_000;
  const receiveSlotWaitMs = positiveInteger(env, "SCOUTUI_UPLOAD_SLOT_WAIT_MS", MAX_TIMER_MS) ?? 60_000;
  if (receiveSlotWaitMs + receiveTimeoutMs > MAX_UPLOAD_WAIT_MS) {
    throw new Error(`SCOUTUI_UPLOAD_SLOT_WAIT_MS (${receiveSlotWaitMs} ms) plus SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS (${receiveTimeoutMs} ms) is ${receiveSlotWaitMs + receiveTimeoutMs} ms. Lower them so they add up to at most ${MAX_UPLOAD_WAIT_MS} ms.`);
  }
  return {
    maxWireBytes,
    maxStoredBytes: positiveInteger(env, "SCOUTUI_MAX_STORED_UPLOAD_BYTES") ?? maxWireBytes,
    maxDecodedBytes: positiveInteger(env, "SCOUTUI_MAX_DECODED_ARTIFACT_BYTES") ?? 64 * MiB,
    receiveTimeoutMs,
    receiveSlots: positiveInteger(env, "SCOUTUI_UPLOAD_RECEIVE_SLOTS") ?? 1,
    receiveSlotWaitMs,
    maxQueuedUploads: positiveInteger(env, "SCOUTUI_MAX_QUEUED_UPLOADS") ?? null,
  };
}

export function scanUploadConfig(): ScanUploadConfig {
  return readScanUploadConfig(process.env);
}
