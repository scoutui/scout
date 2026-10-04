import { NextResponse } from "next/server";
import { getPool } from "@/db/client";
import { can, UPLOAD_REFUSAL } from "@/lib/access";
import { identify } from "@/lib/identity";
import { rateLimit, clientKey, logRateLimitRejection } from "@/lib/rate-limit";
import { tooLarge } from "@/lib/request-body";
import { receiveUpload, UploadReceiveError } from "@/lib/scan-archive";
import { errorClass, uploadQueueFull } from "@/lib/scan-jobs";
import { scanUploadConfig, type ScanUploadConfig } from "@/lib/scan-upload-config";
import { acquireScanUploadSlot } from "@/lib/scan-upload-slot";

const UPLOAD_LIMIT = 30;
const UPLOAD_WINDOW_MS = 600_000;
const RETRY_AFTER_SECONDS = "60";

class RequestBodyError extends Error {
  constructor(cause: unknown) {
    super("Request body could not be read", { cause });
    this.name = "RequestBodyError";
  }
}

function unavailable(error: string): Response {
  return NextResponse.json({ error }, { status: 503, headers: { "Retry-After": RETRY_AFTER_SECONDS } });
}

function clientClosed(): Response {
  return new Response(null, { status: 499 });
}

function uploadEncoding(req: Request): "gzip" | "identity" | null {
  const encoding = req.headers.get("content-encoding")?.trim().toLowerCase();
  if (!encoding || encoding === "identity") return "identity";
  return encoding === "gzip" ? "gzip" : null;
}

/** Streams a request body; cancelling the iteration, an abort or a read error cancels the body reader. */
function requestBody(body: ReadableStream<Uint8Array> | null, signal: AbortSignal): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      if (!body) return { next: async () => ({ done: true, value: undefined }) };
      const reader = body.getReader();
      const cancel = () => {
        signal.removeEventListener("abort", cancel);
        reader.cancel().catch(() => {});
      };
      signal.addEventListener("abort", cancel, { once: true });
      return {
        async next() {
          try {
            const result = await reader.read();
            if (result.done) signal.removeEventListener("abort", cancel);
            return result.done ? { done: true, value: undefined } : { done: false, value: result.value };
          } catch (error) {
            cancel();
            throw new RequestBodyError(error);
          }
        },
        async return() {
          cancel();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

function receiveFailure(error: unknown, config: ScanUploadConfig, signal: AbortSignal): Response {
  if (signal.aborted) return clientClosed();
  if (error instanceof UploadReceiveError) {
    switch (error.code) {
      case "wire_limit": return tooLarge("payload", config.maxWireBytes);
      case "stored_limit": return tooLarge("stored upload", config.maxStoredBytes);
      case "timeout": return unavailable("scan upload timed out; retry later");
      case "queue_full": return unavailable("scan upload queue is full; retry later");
      case "aborted": return clientClosed();
    }
  }
  if (error instanceof RequestBodyError) {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  console.error(`[scans] upload failed: ${errorClass(error)}`);
  return NextResponse.json({ error: "upload failed" }, { status: 500 });
}

export async function POST(req: Request): Promise<Response> {
  let identity: Awaited<ReturnType<typeof identify>>;
  try {
    identity = await identify({ bearer: req.headers.get("authorization") });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(identity, "upload")) {
    return NextResponse.json({ error: UPLOAD_REFUSAL.code, refusal: UPLOAD_REFUSAL }, { status: 403 });
  }

  const key = identity.kind === "ci" ? `scans:ci:${clientKey(req)}` : `scans:user:${identity.userId}`;
  const limited = rateLimit(key, UPLOAD_LIMIT, UPLOAD_WINDOW_MS);
  if (!limited.ok) {
    logRateLimitRejection("scans", key);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const config = scanUploadConfig();
  const encoding = uploadEncoding(req);
  if (!encoding) {
    return NextResponse.json({ error: "unsupported content encoding; send gzip or identity" }, { status: 415 });
  }
  if (Number(req.headers.get("content-length") ?? "0") > config.maxWireBytes) {
    return tooLarge("payload", config.maxWireBytes);
  }

  const release = await acquireScanUploadSlot(req.signal, { slots: config.receiveSlots, waitMs: config.receiveSlotWaitMs });
  if (!release) {
    return req.signal.aborted ? clientClosed() : unavailable("scan upload busy; retry later");
  }
  try {
    const pool = getPool();
    if (config.maxQueuedUploads && await uploadQueueFull(pool, config.maxQueuedUploads)) {
      return unavailable("scan upload queue is full; retry later");
    }
    const { uploadId } = await receiveUpload(
      pool, requestBody(req.body, req.signal), encoding, identity.kind === "ci" ? null : identity.userId,
      { maxWireBytes: config.maxWireBytes, maxStoredBytes: config.maxStoredBytes, timeoutMs: config.receiveTimeoutMs, maxQueuedUploads: config.maxQueuedUploads },
      req.signal, { rescan: new URL(req.url).searchParams.get("rescan") === "1" },
    );
    const statusUrl = `/api/scans/uploads/${uploadId}`;
    return NextResponse.json({ uploadId, statusUrl }, { status: 202, headers: { Location: statusUrl } });
  } catch (error) {
    return receiveFailure(error, config, req.signal);
  } finally {
    release();
  }
}
