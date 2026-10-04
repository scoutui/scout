import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identity", () => ({ identify: vi.fn(async () => ({ kind: "ci" })) }));
vi.mock("@/db/client", () => ({ getPool: () => ({}) }));
vi.mock("@/lib/scan-archive", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/scan-archive")>(),
  receiveUpload: vi.fn(),
}));

import { receiveUpload } from "@/lib/scan-archive";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function request(body: BodyInit, signal?: AbortSignal, headers: Record<string, string> = {}) {
  return new Request("http://x/api/scans", {
    method: "POST", headers: { Authorization: "Bearer ci", ...headers }, body, signal, duplex: "half",
  } as RequestInit);
}

async function drain(input: AsyncIterable<Uint8Array>) {
  for await (const _chunk of input) { /* consume */ }
}

describe("scan upload receive admission", () => {
  let POST: typeof import("@/app/api/scans/route").POST;
  let reads: string[];
  let received: number;
  const pending: ReturnType<typeof deferred>[] = [];

  function streamed(id: string, signal?: AbortSignal) {
    return request(new ReadableStream({
      pull(controller) {
        reads.push(id);
        controller.enqueue(new TextEncoder().encode(id));
        controller.close();
      },
    }, { highWaterMark: 0 }), signal);
  }

  function holdReceive() {
    const held = deferred();
    pending.push(held);
    vi.mocked(receiveUpload).mockImplementationOnce(async (_pool, input) => {
      await drain(input);
      await held.promise;
      return { uploadId: `upload-${++received}` };
    });
    return held;
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(receiveUpload).mockReset().mockImplementation(async (_pool, input) => {
      await drain(input);
      return { uploadId: `upload-${++received}` };
    });
    reads = [];
    received = 0;
    ({ POST } = await import("@/app/api/scans/route"));
  });

  afterEach(async () => {
    for (const held of pending.splice(0)) held.resolve();
    await setImmediate();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("leaves queued bodies unread and admits one receive at a time in order by default", async () => {
    const first = holdReceive();
    const second = holdReceive();
    const a = POST(streamed("first"));
    await setImmediate();
    const b = POST(streamed("second"));
    const c = POST(streamed("third"));
    await setImmediate();
    expect(reads).toEqual(["first"]);

    first.resolve();
    expect((await a).status).toBe(202);
    await setImmediate();
    expect(reads).toEqual(["first", "second"]);

    second.resolve();
    expect((await b).status).toBe(202);
    expect((await c).status).toBe(202);
    expect(reads).toEqual(["first", "second", "third"]);
  });

  it("admits the configured number of simultaneous receives", async () => {
    vi.stubEnv("SCOUTUI_UPLOAD_RECEIVE_SLOTS", "2");
    const first = holdReceive();
    const second = holdReceive();
    const a = POST(streamed("first"));
    const b = POST(streamed("second"));
    const c = POST(streamed("third"));
    await setImmediate();
    await setImmediate();
    expect(reads.sort()).toEqual(["first", "second"]);
    first.resolve();
    expect((await a).status).toBe(202);
    expect((await c).status).toBe(202);
    second.resolve();
    expect((await b).status).toBe(202);
  });

  it("returns 503 with Retry-After after the configured wait without reading the waiting body", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SCOUTUI_UPLOAD_SLOT_WAIT_MS", "5000");
    const held = holdReceive();
    const a = POST(streamed("first"));
    await setImmediate();
    const b = POST(streamed("waiting"));
    await setImmediate();
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await b;
    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await response.json()).toEqual({ error: "scan upload busy; retry later" });
    expect(reads).toEqual(["first"]);
    held.resolve();
    await a;
    expect((await POST(streamed("after-wait"))).status).toBe(202);
    expect(reads).toEqual(["first", "after-wait"]);
  });

  it("removes an aborted waiter without releasing the active receive", async () => {
    const held = holdReceive();
    const a = POST(streamed("first"));
    await setImmediate();
    const abort = new AbortController();
    const b = POST(streamed("aborted", abort.signal));
    const c = POST(streamed("third"));
    await setImmediate();
    abort.abort();
    expect((await b).status).toBe(499);
    expect(reads).toEqual(["first"]);
    held.resolve();
    await a;
    expect((await c).status).toBe(202);
    expect(reads).toEqual(["first", "third"]);
  });

  it("does not read a request that was already aborted", async () => {
    expect((await POST(streamed("aborted", AbortSignal.abort()))).status).toBe(499);
    expect(reads).toEqual([]);
    expect((await POST(streamed("next"))).status).toBe(202);
  });

  it("releases the slot when a receive fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(receiveUpload).mockRejectedValueOnce(Object.assign(new Error("connection refused"), { code: "08006" }));
    const a = POST(streamed("failed"));
    const b = POST(streamed("next"));
    expect((await a).status).toBe(500);
    expect((await b).status).toBe(202);
  });
});
