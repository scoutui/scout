import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProgress, startPhase } from "../../../src/util/progress.js";
import { createColor } from "../../../src/util/color.js";

const plain = createColor({ isTTY: false, env: {} });
const colored = createColor({ isTTY: true, env: {} });

describe("phase line", () => {
  it("writes the phase once in a log", () => {
    const writes: string[] = [];
    const phase = startPhase({ label: "Matching occurrences to components…", writer: (s) => writes.push(s), isTTY: false });
    phase.done();
    expect(writes).toEqual(["Matching occurrences to components…\n"]);
  });

  it("writes the phase in place in a terminal, cut to its width, and clears it when done", () => {
    const writes: string[] = [];
    const phase = startPhase({ label: "Matching occurrences to components…", writer: (s) => writes.push(s), isTTY: true, columns: 10 });
    phase.done();
    expect(writes).toEqual(["\rMatching \x1b[K", "\r\x1b[K"]);
  });
});

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

  it("in a log, writes the first tick, then at most one line every 10 seconds whatever the count, and no line for the last tick", () => {
    const p = createProgress({ total: 1000, writer, isTTY: false });
    p.tick();
    for (let i = 0; i < 200; i++) p.tick();
    vi.advanceTimersByTime(9_999);
    p.tick();
    expect(writes).toEqual(["Reading files: 1 of 1000 (0.1%), 0.0s\n"]);
    vi.advanceTimersByTime(1);
    p.tick();
    expect(writes).toEqual(["Reading files: 1 of 1000 (0.1%), 0.0s\n", "Reading files: 203 of 1000 (20.3%), 10.0s\n"]);
    for (let i = 0; i < 797; i++) p.tick();
    p.done();
    expect(writes).toHaveLength(2);
  });

  it("in a terminal, cuts the line to the terminal's width so it can be rewritten in place", () => {
    const p = createProgress({ total: 929, writer, isTTY: true, columns: 20 });
    p.tick();
    expect(writes).toEqual(["\rReading files: 1 of\x1b[K"]);
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

describe("progress with motion", () => {
  let writes: string[];
  const writer = (s: string) => {
    writes.push(s);
  };
  beforeEach(() => {
    writes = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns a spinner before a phase's label each frame, cut to the terminal's width, and stops when done", () => {
    const phase = startPhase({ label: "Matching occurrences to components…", writer, isTTY: true, columns: 12, motion: plain });
    vi.advanceTimersByTime(80);
    phase.done();
    vi.advanceTimersByTime(800);
    expect(writes).toEqual(["\r⠋ Matching \x1b[K", "\r⠙ Matching \x1b[K", "\r\x1b[K"]);
  });

  it("draws a bar after a phase's label when given how far along it is, and leaves it out when the terminal is narrow", () => {
    startPhase({ label: "Installing dependencies…", writer, isTTY: true, columns: 80, motion: plain, fraction: 0.5 }).done();
    startPhase({ label: "Installing dependencies…", writer, isTTY: true, columns: 30, motion: plain, fraction: 0.5 }).done();
    expect(writes.filter((w) => w !== "\r\x1b[K")).toEqual([
      `\r⠋ Installing dependencies…  ${"━".repeat(15)}${"─".repeat(15)}\x1b[K`,
      "\r⠋ Installing dependencies…\x1b[K",
    ]);
  });

  it("draws a spinner, a bar, the count, the percentage and the time across a wide terminal", () => {
    const p = createProgress({ total: 929, writer, isTTY: true, columns: 80, motion: plain });
    p.tick();
    expect(writes).toEqual([`\r⠋ Reading files  ${"─".repeat(30)}  1 of 929  0%  0.0s\x1b[K`]);
  });

  it.each([
    [1, `╸${"─".repeat(29)}`],
    [30, `${"━".repeat(15)}${"─".repeat(15)}`],
    [60, "━".repeat(30)],
  ])("fills the bar in half cells (%i of 60)", (count, filled) => {
    const p = createProgress({ total: 60, writer, isTTY: true, columns: 80, motion: plain });
    for (let i = 0; i < count; i++) p.tick();
    vi.advanceTimersByTime(80);
    expect(writes.at(-1)).toContain(`Reading files  ${filled}  ${count} of 60`);
  });

  it("turns the spinner each frame between ticks, and stops redrawing when done", () => {
    const p = createProgress({ total: 929, writer, isTTY: true, columns: 80, motion: plain });
    p.tick();
    vi.advanceTimersByTime(80);
    p.done();
    vi.advanceTimersByTime(800);
    expect(writes.map((w) => w.slice(0, 2))).toEqual(["\r⠋", "\r⠙", "\r\x1b"]);
  });

  it("leaves the bar out in a narrow terminal, and cuts the line before colouring the spinner", () => {
    const p = createProgress({ total: 929, writer, isTTY: true, columns: 30, motion: colored });
    p.tick();
    expect(writes).toEqual(["\r\x1b[36m⠋\x1b[0m Reading files: 1 of 929 (0.\x1b[K"]);
  });

  it("writes the same lines as without motion in a log", () => {
    const p = createProgress({ total: 1000, writer, isTTY: false, motion: plain });
    p.tick();
    vi.advanceTimersByTime(800);
    p.done();
    expect(writes).toEqual(["Reading files: 1 of 1000 (0.1%), 0.0s\n"]);
  });
});
