import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireScanUploadSlot } from "@/lib/scan-upload-slot";

const never = new AbortController().signal;

describe("scan upload receive slots", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("admits up to the configured number of receives at once, then waiters in order", async () => {
    const options = { slots: 2, waitMs: 10_000 };
    const first = await acquireScanUploadSlot(never, options);
    const second = await acquireScanUploadSlot(never, options);
    expect(first).toBeTypeOf("function");
    expect(second).toBeTypeOf("function");
    const admitted: string[] = [];
    const third = acquireScanUploadSlot(never, options).then((release) => { admitted.push("third"); return release; });
    const fourth = acquireScanUploadSlot(never, options).then((release) => { admitted.push("fourth"); return release; });
    await Promise.resolve();
    expect(admitted).toEqual([]);
    first?.();
    first?.();
    const thirdRelease = await third;
    expect(admitted).toEqual(["third"]);
    second?.();
    const fourthRelease = await fourth;
    expect(admitted).toEqual(["third", "fourth"]);
    thirdRelease?.();
    fourthRelease?.();
  });

  it("gives up after the configured wait", async () => {
    vi.useFakeTimers();
    const options = { slots: 1, waitMs: 5_000 };
    const held = await acquireScanUploadSlot(never, options);
    const waiting = acquireScanUploadSlot(never, options);
    await vi.advanceTimersByTimeAsync(4_999);
    const settled = vi.fn();
    void waiting.then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await waiting).toBeNull();
    held?.();
    const next = await acquireScanUploadSlot(never, options);
    expect(next).toBeTypeOf("function");
    next?.();
  });

  it("drops an aborted waiter without taking a slot", async () => {
    const options = { slots: 1, waitMs: 10_000 };
    const held = await acquireScanUploadSlot(never, options);
    const abort = new AbortController();
    const waiting = acquireScanUploadSlot(abort.signal, options);
    abort.abort();
    expect(await waiting).toBeNull();
    expect(await acquireScanUploadSlot(AbortSignal.abort(), options)).toBeNull();
    held?.();
    const next = await acquireScanUploadSlot(never, options);
    expect(next).toBeTypeOf("function");
    next?.();
  });
});
