import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProgress } from "../../../src/util/progress.js";

describe("progress reporter", () => {
  let writes: string[];
  let writer: (s: string) => void;
  beforeEach(() => {
    writes = [];
    writer = (s) => { writes.push(s); };
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it("emits the first tick on the very first call", () => {
    const p = createProgress({ total: 100, writer, isTTY: true });
    p.tick();
    expect(writes.length).toBe(1);
    expect(writes[0]).toContain("1 of 100");
  });

  it("rate-limits to every 50 ticks (count-based gate)", () => {
    const p = createProgress({ total: 1000, writer, isTTY: true });
    for (let i = 0; i < 49; i++) p.tick();
    expect(writes.length).toBe(1); // only the first
    p.tick(); // 50th since last emit
    expect(writes.length).toBe(2);
  });

  it("rate-limits to every 250ms (time-based gate)", () => {
    const p = createProgress({ total: 1000, writer, isTTY: true });
    p.tick();
    expect(writes.length).toBe(1);
    p.tick();
    expect(writes.length).toBe(1);
    vi.advanceTimersByTime(251);
    p.tick();
    expect(writes.length).toBe(2);
  });

  it("emits without ANSI carriage return when not a TTY (CI logs)", () => {
    const p = createProgress({ total: 100, writer, isTTY: false });
    p.tick();
    expect(writes[0]).not.toContain("\r");
    expect(writes[0]).toMatch(/\n$/);
  });

  it("uses carriage return + clear-line when isTTY", () => {
    const p = createProgress({ total: 100, writer, isTTY: true });
    p.tick();
    expect(writes[0]).toMatch(/^\r/);
  });

  it("done() clears the line on TTY", () => {
    const p = createProgress({ total: 100, writer, isTTY: true });
    p.tick();
    p.done();
    const last = writes[writes.length - 1];
    expect(last?.startsWith("\r")).toBe(true);
    expect(last?.endsWith("\x1b[K")).toBe(true);
  });

  it("done() is a no-op when not isTTY (the line already ended)", () => {
    const p = createProgress({ total: 100, writer, isTTY: false });
    p.tick();
    const before = writes.length;
    p.done();
    expect(writes.length).toBe(before);
  });

  it("includes elapsed seconds in the message", () => {
    const p = createProgress({ total: 100, writer, isTTY: true });
    vi.advanceTimersByTime(3500);
    p.tick();
    expect(writes[0]).toMatch(/, 3\.5s/);
  });

  it("writes the label, the count of the total, the percentage and the seconds elapsed", () => {
    const p = createProgress({ total: 412, writer, isTTY: false, label: "Reading files" });
    vi.advanceTimersByTime(1200);
    p.tick();
    expect(writes).toEqual(["Reading files: 1 of 412 (0.2%), 1.2s\n"]);
  });

  it("always emits on the final tick so the bar shows 100%", () => {
    const p = createProgress({ total: 3, writer, isTTY: true });
    p.tick(); // 1/3: emits via "first tick" branch
    p.tick(); // 2/3: no emit (below count/time thresholds)
    expect(writes.length).toBe(1);
    p.tick(); // 3/3: emits via "processed === total" branch
    expect(writes.length).toBe(2);
    expect(writes[1]).toContain("3 of 3");
    expect(writes[1]).toContain("100.0%");
  });

  it("emits only through the supplied writer (no hidden stderr path under --quiet)", () => {
    // scan.ts passes a no-op writer under --quiet, so the writer must be
    // createProgress's only output channel.
    const spies: { stderr: number } = { stderr: 0 };
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((_chunk: unknown) => {
      spies.stderr += 1;
      return true;
    }) as typeof process.stderr.write;
    try {
      const p = createProgress({ total: 100, writer: () => {}, isTTY: true });
      for (let i = 0; i < 200; i++) p.tick();
      vi.advanceTimersByTime(1000);
      p.tick();
      p.done();
      expect(spies.stderr).toBe(0);
    } finally {
      process.stderr.write = origStderrWrite;
    }
  });
});
