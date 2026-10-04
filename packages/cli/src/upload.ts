import { gzipSync } from "node:zlib";
import { formatAuthError, NoHostError } from "./auth/session.js";
import { InvalidHostError } from "./auth/store.js";
import { CliError } from "./cli/parse.js";
import { readCliPackage } from "./scan/meta.js";
import { errorMessage, errorStack } from "./util/errors.js";

export type UploadReceipt = { uploadId: string; statusUrl: string };

export type UploadStatus = {
  state: "queued" | "processing" | "ready" | "duplicate" | "failed";
  readable: boolean;
  scanId?: string;
  url?: string;
  replaced?: true;
  stage?: string;
  retryAfterSeconds?: number;
  error?: { code: string; message: string };
};

/** Whether the dashboard is still working on an upload: queued, processing, or a duplicate that isn't readable yet. */
export function uploadPending(status: UploadStatus): boolean {
  return status.state === "queued" || status.state === "processing" || (!status.readable && status.state === "duplicate");
}

function statusUrl(host: string, receipt: UploadReceipt): string {
  const base = new URL(host);
  const url = new URL(receipt.statusUrl, base);
  if (url.origin !== base.origin || url.username || url.password) {
    throw new Error("Upload status URL must have the same origin as the upload host");
  }
  return url.href;
}

export class UploadPendingError extends Error {
  constructor(public receipt: UploadReceipt, public statusUrl: string, lastFailure?: { reason: string; error: unknown }) {
    const failure = lastFailure ? ` The last status check failed: ${lastFailure.reason}.` : "";
    super(
      `Upload ${receipt.uploadId} is still pending. Check ${statusUrl}; the server job continues.${failure}`,
      lastFailure ? { cause: lastFailure.error } : undefined,
    );
  }
}

/** The dashboard received the scan and refused it, with its own message and code. */
export class UploadRefusedError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusUrl: string,
  ) {
    super(message);
  }
}

/** Waiting for the dashboard stopped before it said how the upload ended. */
export class UploadPollingError extends Error {
  constructor(
    public receipt: UploadReceipt,
    public statusUrl: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }

  get code(): number | undefined {
    return this.cause instanceof UploadError ? this.cause.code : undefined;
  }
}

export async function getUploadStatus(opts: {
  host: string;
  receipt: UploadReceipt;
  token: string;
  signal?: AbortSignal;
}): Promise<UploadStatus> {
  const url = statusUrl(opts.host, opts.receipt);
  opts.signal?.throwIfAborted();
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: { Authorization: `Bearer ${opts.token}` },
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new UploadError(response.status, `Upload status failed (${response.status})`, retryAfterSeconds, body);
  }
  const status = await response.json() as UploadStatus;
  if (retryAfterSeconds !== undefined) status.retryAfterSeconds = retryAfterSeconds;
  return status;
}

/** A `Retry-After` header's wait in seconds, from either a number of seconds or a date, or undefined when there's none. */
export function parseRetryAfter(retryAfter: string | null): number | undefined {
  if (retryAfter === null) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(retryAfter.trim())
    ? Number(retryAfter)
    : (Date.parse(retryAfter) - Date.now()) / 1_000;
  return Number.isFinite(seconds) ? Math.max(0, seconds) : undefined;
}

const TRANSIENT_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN", "UND_ERR_SOCKET"]);

function transientReason(err: unknown): string | undefined {
  if (err instanceof UploadError) return TRANSIENT_STATUSES.has(err.code) ? err.message : undefined;
  const seen = new Set<unknown>();
  for (let current = err; typeof current === "object" && current !== null && !seen.has(current); current = (current as { cause?: unknown }).cause) {
    seen.add(current);
    const { code } = current as { code?: unknown };
    if (typeof code === "string" && TRANSIENT_CODES.has(code)) {
      return err instanceof Error ? `${err.message} (${code})` : code;
    }
  }
  return undefined;
}

function backoffDelay(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

export async function pollUpload(opts: {
  host: string;
  receipt: UploadReceipt;
  getToken: () => Promise<string>;
  onUnauthorized: () => Promise<string>;
  timeoutMs: number;
  signal?: AbortSignal;
  onStatus?: (status: UploadStatus) => void;
}): Promise<UploadResult> {
  const url = statusUrl(opts.host, opts.receipt);
  const controller = new AbortController();
  const signal = controller.signal;
  const abort = () => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener("abort", abort, { once: true });
  let lastFailure: { reason: string; error: unknown } | undefined;
  const timer = setTimeout(() => controller.abort(new UploadPendingError(opts.receipt, url, lastFailure)), opts.timeoutMs);
  const cancelled = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  async function run(): Promise<UploadResult> {
    opts.signal?.throwIfAborted();
    let token = await opts.getToken();
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const inspect = () => getUploadStatus({ host: opts.host, receipt: opts.receipt, token, signal });
      let status: UploadStatus | undefined;
      let hint: number | undefined;
      try {
        status = await inspect().catch(async (err: unknown) => {
          if (!(err instanceof UploadError) || err.code !== 401) throw err;
          signal.throwIfAborted();
          token = await opts.onUnauthorized();
          return await inspect();
        });
      } catch (err) {
        const reason = transientReason(err);
        if (reason === undefined) throw err;
        lastFailure = { reason, error: err };
        hint = err instanceof UploadError ? err.retryAfterSeconds : undefined;
      }
      signal.throwIfAborted();
      if (status) {
        lastFailure = undefined;
        opts.onStatus?.(status);
        if (status.state === "failed") {
          throw new UploadRefusedError(status.error?.message ?? DASHBOARD_ERROR, status.error?.code ?? "unknown", url);
        }
        if (status.readable && (status.state === "ready" || status.state === "duplicate")) {
          return status.state === "ready"
            ? { status: "inserted", scanId: status.scanId as string, url: status.url as string, ...(status.replaced ? { replaced: true as const } : {}) }
            : { status: "exists", scanId: status.scanId as string, url: status.url as string };
        }
        hint = status.retryAfterSeconds;
      }
      const delay = hint !== undefined ? hint * 1_000 : backoffDelay(attempt);
      await wait(Math.min(2_147_483_647, Math.max(1_000, delay)), signal);
    }
  }
  try {
    return await Promise.race([run(), cancelled]);
  } catch (err) {
    if (err instanceof UploadPendingError || err instanceof UploadPollingError || err instanceof UploadRefusedError) throw err;
    throw new UploadPollingError(opts.receipt, url, err);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}

function wait(delay: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export type UploadResult =
  | { status: "inserted"; scanId: string; url: string; replaced?: true }
  | { status: "exists"; scanId: string; url: string };

/** The dashboard answered with an error status; `body` is its reply. */
export class UploadError extends Error {
  constructor(
    public code: number,
    message: string,
    public retryAfterSeconds?: number,
    public body?: string,
  ) {
    super(message);
  }
}

const GZIP_THRESHOLD = 1024 * 1024; // 1 MB
const SEND_ATTEMPTS = 3;

/**
 * Runs `send`, and runs it again when it fails because the dashboard is unavailable (HTTP 502, 503 or 504) or the connection
 * failed, up to three attempts in all. The wait between attempts grows, and a `Retry-After` hint lengthens it up to 30
 * seconds. The last failure is thrown.
 */
export async function withTransientRetry<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      if (attempt >= SEND_ATTEMPTS || transientReason(err) === undefined) throw err;
      const hint = err instanceof UploadError ? err.retryAfterSeconds : undefined;
      const backoff = backoffDelay(attempt - 1);
      await wait(hint === undefined ? backoff : Math.max(backoff, Math.min(hint * 1_000, 30_000)));
    }
  }
}

export async function submitArtifact(opts: {
  host: string;
  token: string;
  artifactJson: string;
  rescan?: boolean;
}): Promise<UploadReceipt> {
  const url = `${opts.host.replace(/\/$/, "")}/api/scans${opts.rescan ? "?rescan=1" : ""}`;
  const useGzip = opts.artifactJson.length > GZIP_THRESHOLD;
  const body: string | Buffer = useGzip
    ? gzipSync(Buffer.from(opts.artifactJson, "utf8"))
    : opts.artifactJson;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${opts.token}`,
  };
  if (useGzip) headers["Content-Encoding"] = "gzip";
  return await withTransientRetry(() => postArtifact(url, headers, body));
}

async function postArtifact(url: string, headers: Record<string, string>, body: string | Buffer): Promise<UploadReceipt> {
  const res = await fetch(url, { method: "POST", headers, body, redirect: "error" });
  if (res.status === 202) {
    return await res.json() as UploadReceipt;
  }
  const text = await res.text().catch(() => "");
  if (res.status === 403) {
    const { refusal } = (parseJsonObject(text) ?? {}) as { refusal?: { code?: unknown; message?: unknown } };
    if (typeof refusal?.code === "string" && typeof refusal.message === "string") throw new UploadRefusedError(refusal.message, refusal.code, url);
  }
  throw new UploadError(res.status, `Upload failed (${res.status}): ${text || res.statusText}`, parseRetryAfter(res.headers.get("Retry-After")), text);
}

/** `text` parsed as JSON when it is an object, or undefined. */
function parseJsonObject(text: string): object | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const DASHBOARD_ERROR = "Couldn't upload the scan: the dashboard returned an error. Try again, or ask your dashboard administrator to check its logs.";

/** Whether `err` is fetch failing to connect: a network error code somewhere in its causes. */
function isNetworkError(err: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current = err; typeof current === "object" && current !== null && !seen.has(current); current = (current as { cause?: unknown }).cause) {
    seen.add(current);
    const { code } = current as { code?: unknown };
    if (typeof code === "string" && /^(E[A-Z]+|UND_ERR_[A-Z_]+)$/.test(code)) return true;
  }
  return err instanceof TypeError && err.message === "fetch failed";
}

/** Whether `body` is JSON, as every reply from a Scout dashboard is. */
function isJson(body: string | undefined): boolean {
  try {
    JSON.parse(body ?? "");
    return true;
  } catch {
    return false;
  }
}

function replyDetail(err: UploadError): string {
  return `The dashboard replied: HTTP ${err.code}${err.body ? ` ${err.body}` : ""}`;
}

const DOCS = "https://scoutui.dev/docs";

/** The page that explains a dashboard refusal, by its code, or undefined when there's none. */
function pageFor(code: string): string | undefined {
  if (code === "decoded_limit") return `${DOCS}/guides/deploy-with-your-own-chart#change-an-upload-limit`;
  if (code === "unsupported_version") return `${DOCS}/guides/upgrade-scout#version-messages`;
  if (code === "repo_remote_mismatch") return `${DOCS}/guides/troubleshoot-a-scan#repository-from-another-remote`;
  if (code === "invalid_artifact") return readCliPackage().bugs;
  return undefined;
}

/** `message`, followed by the page that explains the refusal `code` when there is one. */
export function withDocsLink(message: string, code: string): string {
  const page = pageFor(code);
  return page === undefined ? message : `${message} See ${page}`;
}

/**
 * The one line a failed upload prints, and the detail `--debug` adds. `host`
 * is the dashboard, once it's known.
 */
export function describeUploadError(err: unknown, host: string | undefined): { message: string; detail?: string } {
  const auth = formatAuthError(err) ?? (err instanceof UploadPollingError ? formatAuthError(err.cause) : null);
  if (auth !== null) return { message: auth };
  if (err instanceof NoHostError) {
    return {
      message: `Couldn't upload the scan: no dashboard address is set. Add "host" to scout.config.json or set SCOUTUI_HOST, or run scout scan --dry-run to scan without uploading.`,
    };
  }
  if (err instanceof CliError || err instanceof InvalidHostError) return { message: err.message };
  if (err instanceof UploadRefusedError) return { message: withDocsLink(err.message, err.code), detail: `${err.code} (${err.statusUrl})` };
  if (err instanceof UploadPendingError) {
    return {
      message: "The dashboard is still processing the scan after 5 minutes. It will appear on the dashboard when it's done.",
      detail: err.message,
    };
  }
  if (err instanceof UploadPollingError) {
    return {
      message: "Lost contact with the dashboard while it processed the scan. Check the dashboard in a few minutes, and scan again if the scan isn't there.",
      detail: `${err.statusUrl}: ${errorStack(err.cause)}`,
    };
  }
  if (err instanceof UploadError) {
    if (err.code === 413) {
      return {
        message: withDocsLink("Couldn't upload the scan: it's larger than the dashboard accepts. Ask your dashboard administrator to raise the upload limit.", "decoded_limit"),
        detail: replyDetail(err),
      };
    }
    if (err.code === 429 || err.code === 503) {
      return { message: "Couldn't upload the scan: the dashboard is busy. Try again in a few minutes.", detail: replyDetail(err) };
    }
    if (err.code < 500 && !isJson(err.body)) {
      return {
        message: `Couldn't upload the scan: ${host ?? "the address"} didn't answer like a Scout dashboard. Check the dashboard address and try again.`,
        detail: replyDetail(err),
      };
    }
    return { message: DASHBOARD_ERROR, detail: replyDetail(err) };
  }
  if (host !== undefined && isNetworkError(err)) {
    return { message: `Couldn't reach ${host}. Check your connection and try again.`, detail: errorStack(err) };
  }
  return { message: `Couldn't upload the scan: ${errorMessage(err)}`, detail: errorStack(err) };
}
