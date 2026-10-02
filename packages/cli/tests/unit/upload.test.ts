import { gunzipSync } from "node:zlib";
import { describe, it, expect, vi, afterEach } from "vitest";
import * as transport from "../../src/upload.js";

const host = "https://uploads.example";
const receipt = { uploadId: "U1", statusUrl: "/api/scans/uploads/U1" };
const ready = { state: "ready", readable: true, scanId: "S1", url: "/repos/repo-a/scans/S1" };

function poll(overrides: Partial<Parameters<typeof transport.pollUpload>[0]> = {}) {
  return transport.pollUpload({
    host, receipt, getToken: async () => "token", onUnauthorized: async () => "refreshed",
    timeoutMs: 10_000, ...overrides,
  });
}

function connectionError(code: string) {
  return new TypeError("fetch failed", {
    cause: new Error("socket failure", { cause: Object.assign(new Error(`read ${code}`), { code }) }),
  });
}

function submit(artifactJson = "{}") {
  return transport.submitArtifact({ host, token: "token", artifactJson });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function respondWith(sent: (Response | Error)[], next: () => Response | Error) {
  return async () => {
    const response = next();
    sent.push(response);
    if (response instanceof Error) throw response;
    return response;
  };
}

const retryable = [
  ...[502, 503, 504].map((status) => ({ name: String(status), failure: () => Response.json({ detail: "busy" }, { status }) })),
  ...["ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN", "UND_ERR_SOCKET"].map((code) => ({ name: code, failure: () => connectionError(code) })),
];

const fatal = [
  ...[400, 403, 404, 413, 415, 429, 500].map((status) => ({ name: String(status), failure: () => Response.json({}, { status }) })),
  { name: "unrecognised connection error", failure: () => connectionError("ERR_TLS_CERT_ALTNAME_INVALID") },
];

describe("upload retries", () => {
  it.each([
    ...retryable,
    { name: "503 with Retry-After", failure: () => Response.json({}, { status: 503, headers: { "Retry-After": "1" } }) },
  ])("retries a $name submission with growing backoff and gives up after three attempts", async ({ failure }) => {
    vi.useFakeTimers();
    const sent: (Response | Error)[] = [];
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(respondWith(sent, failure));
    let error: unknown;
    submit().catch((caught) => { error = caught; });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const last = sent[2];
    if (last instanceof Response) expect(error).toMatchObject({ code: last.status });
    else expect(error).toBe(last);
    expect(sent.every((response) => response instanceof Error || response.bodyUsed)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(retryable)("retries a $name mid-poll within the timeout and reaches ready", async ({ failure }) => {
    vi.useFakeTimers();
    const sent: (Response | Error)[] = [];
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(Response.json({ state: "queued", readable: false }))
      .mockImplementationOnce(respondWith(sent, failure))
      .mockResolvedValueOnce(Response.json(ready));
    const progress: string[] = [];
    const result = poll({ onStatus: (status) => progress.push(status.state) });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ status: "inserted", scanId: "S1", url: "/repos/repo-a/scans/S1" });
    expect(progress).toEqual(["queued", "ready"]);
    expect(sent.every((response) => response instanceof Error || response.bodyUsed)).toBe(true);
  });

  it.each([
    { name: "503", responses: [() => Response.json({}, { status: 503 })], reason: "Upload status failed (503)" },
    { name: "connection reset", responses: [() => connectionError("ECONNRESET")], reason: "fetch failed (ECONNRESET)" },
    { name: "recovered status check", responses: [() => Response.json({}, { status: 503 }), () => Response.json({ state: "queued", readable: false })], reason: undefined },
  ])("keeps the receipt and reports the last failure when the wait expires after a $name", async ({ responses, reason }) => {
    vi.useFakeTimers();
    const sent: (Response | Error)[] = [];
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(
      respondWith(sent, () => (responses[sent.length] ?? responses[responses.length - 1] as () => Response | Error)()));
    let error: unknown;
    poll({ timeoutMs: 2_500 }).catch((caught) => { error = caught; });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(error).toBeInstanceOf(transport.UploadPendingError);
    expect(error).toMatchObject({ receipt, statusUrl: `${host}/api/scans/uploads/U1` });
    const { message, cause } = error as Error;
    const last = sent.at(-1);
    if (reason === undefined) {
      expect(message).not.toMatch(/last status check failed/);
      expect(cause).toBeUndefined();
    } else {
      expect(message).toContain(`The last status check failed: ${reason}.`);
      if (last instanceof Response) expect(cause).toMatchObject({ code: last.status });
      else expect(cause).toBe(last);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(fatal)("does not retry a $name submission", async ({ failure }) => {
    const sent: (Response | Error)[] = [];
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(respondWith(sent, failure));
    const error = await submit().catch((caught: unknown) => caught);
    const [response] = sent;
    if (response instanceof Response) expect(error).toMatchObject({ code: response.status });
    else expect(error).toBe(response);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each(fatal)("stops polling on a $name without retrying", async ({ failure }) => {
    const sent: (Response | Error)[] = [];
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(respondWith(sent, failure));
    const error = await poll().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(transport.UploadPollingError);
    expect(error).toMatchObject({ receipt });
    const [response] = sent;
    if (response instanceof Response) expect(error).toMatchObject({ code: response.status });
    else expect((error as Error).cause).toBe(response);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    { header: "10", delay: 10_000 },
    { header: "600", delay: 30_000 },
    { header: "0", delay: 1_000 },
  ])("waits $delay ms for a Retry-After of $header before the next POST", async ({ header, delay }) => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(Response.json({}, { status: 503, headers: { "Retry-After": header } }))
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }));
    const result = submit();
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual(receipt);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: "a 503 Retry-After", response: () => Response.json({}, { status: 503, headers: { "Retry-After": "5" } }), delay: 5_000 },
    { name: "a status hint", response: () => Response.json({ state: "processing", readable: false, retryAfterSeconds: 2 }), delay: 2_000 },
    { name: "a Retry-After over the status hint", response: () => Response.json({ state: "processing", readable: false, retryAfterSeconds: 1 }, { headers: { "Retry-After": "3" } }), delay: 3_000 },
    { name: "an HTTP-date Retry-After", response: () => Response.json({ state: "processing", readable: false, retryAfterSeconds: 1 }, { headers: { "Retry-After": "Wed, 01 Jan 2031 00:00:04 GMT" } }), delay: 4_000 },
  ])("waits $delay ms for $name before the next GET", async ({ response, delay }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockImplementationOnce(async () => response())
      .mockResolvedValueOnce(Response.json(ready));
    const result = poll();
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).status).toBe("inserted");
  });

  it("re-sends the same compressed bytes on every attempt", async () => {
    vi.useFakeTimers();
    const artifactJson = JSON.stringify({ value: "x".repeat(1024 * 1024) });
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json(receipt, { status: 202 }));
    const result = submit(artifactJson);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toEqual(receipt);
    const [first, second] = fetchSpy.mock.calls.map(([, init]) => init);
    expect(second?.body).toBe(first?.body);
    expect(new Headers(second?.headers).get("Content-Encoding")).toBe("gzip");
    expect(gunzipSync(second?.body as Buffer).toString()).toBe(artifactJson);
  });
});

describe("pollUpload", () => {
  it.each(["transport", "500", "refresh", "token", "cancelled"])("preserves the receipt and cause when polling stops after %s failure", async (mode) => {
    const cause = new Error("connection reset");
    const fetchSpy = vi.spyOn(global, "fetch");
    if (mode === "500" || mode === "refresh") {
      fetchSpy.mockResolvedValue(Response.json({}, { status: mode === "500" ? 500 : 401 }));
    } else {
      fetchSpy.mockRejectedValue(cause);
    }
    const error = await poll({
      onUnauthorized: async () => { throw cause; },
      ...(mode === "token" ? { getToken: async () => { throw cause; } } : {}),
      ...(mode === "cancelled" ? { signal: AbortSignal.abort(cause) } : {}),
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ receipt, statusUrl: "https://uploads.example/api/scans/uploads/U1" });
    if (mode === "500") {
      expect(error).toMatchObject({ code: 500, cause: expect.any(transport.UploadError) });
    } else {
      expect(error).toMatchObject({ cause });
      expect((error as Error).cause).toBe(cause);
    }
    expect(fetchSpy.mock.calls.map(([, init]) => init?.method)).toEqual(mode === "token" || mode === "cancelled" ? [] : ["GET"]);
  });

  it("reports a permanent processing failure without another request", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(Response.json({
      state: "failed", readable: false, error: { code: "decoded_size_limit", message: "Decoded artifact is too large" },
    }));
    let error: unknown;
    const result = poll().catch((caught) => { error = caught; });
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toBeInstanceOf(transport.UploadRefusedError);
    await result;
    expect(error).toMatchObject({
      message: "Decoded artifact is too large",
      code: "decoded_size_limit",
      statusUrl: "https://uploads.example/api/scans/uploads/U1",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each(["pending", "stalled request", "stalled token"])("bounds a %s wait and preserves the receipt for inspection", async (mode) => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => {
      if (mode === "stalled request") return new Promise<Response>(() => {});
      return Response.json({ state: "queued", readable: false });
    });
    let error: unknown;
    poll({
      timeoutMs: 500,
      ...(mode === "stalled token" ? { getToken: () => new Promise<string>(() => {}) } : {}),
    }).catch((caught) => { error = caught; });
    await vi.advanceTimersByTimeAsync(500);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(transport.UploadPendingError);
    expect(error).toMatchObject({ receipt, statusUrl: `${host}/api/scans/uploads/U1` });
    expect((error as Error).message).toMatch(/U1.*https:\/\/uploads.example\/api\/scans\/uploads\/U1/);
    expect(fetchSpy).toHaveBeenCalledTimes(mode === "stalled token" ? 0 : 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["https://foreign.example/status", "//foreign.example/status"])("rejects foreign receipt %s before obtaining credentials", async (statusUrl) => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(Response.json(ready));
    const getToken = vi.fn(async () => "secret");
    await expect(poll({ receipt: { ...receipt, statusUrl }, getToken })).rejects.toThrow(/same origin/i);
    expect(getToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows authenticated status inspection without submitting an artifact or following redirects", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(Response.json(ready));
    expect(await transport.getUploadStatus({ host, receipt, token: "token" })).toEqual(ready);
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(`${host}/api/scans/uploads/U1`,
      expect.objectContaining({ method: "GET", redirect: "error", headers: { Authorization: "Bearer token" } }));
  });

  it("cancels waiting locally without cancelling the server job", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(Response.json({ state: "queued", readable: false }));
    let error: unknown;
    poll({ signal: controller.signal }).catch((caught) => { error = caught; });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("stopped waiting"));
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toMatchObject({ message: "stopped waiting" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits through queued and processing before returning a readable scan", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(Response.json({ state: "queued", readable: false }))
      .mockResolvedValueOnce(Response.json({ state: "processing", readable: false, stage: "publishing" }))
      .mockResolvedValueOnce(Response.json(ready));
    const progress: string[] = [];
    const result = poll({ onStatus: (status) => progress.push(status.stage ?? status.state) });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await result).toEqual({ status: "inserted", scanId: "S1", url: "/repos/repo-a/scans/S1" });
    expect(progress).toEqual(["queued", "publishing", "ready"]);
    expect(fetchSpy.mock.calls.map(([url, init]) => [url, init?.method, new Headers(init?.headers).get("Authorization")]))
      .toEqual(Array(3).fill([`${host}/api/scans/uploads/U1`, "GET", "Bearer token"]));
  });

  it.each(["duplicate", "ready"])("waits when a %s receipt is not yet readable", async (state) => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(Response.json({ ...ready, state, readable: false }))
      .mockResolvedValueOnce(Response.json({ ...ready, state }));
    let settled = false;
    const result = poll().then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await result).status).toBe(state === "duplicate" ? "exists" : "inserted");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("submitArtifact", () => {
  it("returns the durable receipt from one authenticated POST", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(Response.json(receipt, { status: 202 }));
    expect(await transport.submitArtifact({ host, token: "token", artifactJson: "{}" })).toEqual(receipt);
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(`${host}/api/scans`, expect.objectContaining({
      method: "POST", body: "{}", redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
    }));
  });
});
