/**
 * Progress for the scan's phases, written to stderr. In a terminal, one line
 * rewritten in place, cut to the terminal's width so it never wraps; with
 * motion, a spinner turns at its start and a bar fills as the count grows. In
 * a log (CI), whole lines, few enough that the log stays readable.
 */
import type { Colorizer } from "./color.js";

export type ProgressOptions = {
  total: number;
  writer: (s: string) => void;
  isTTY: boolean;
  /** The text before the colon in the rendered line (default: "Reading files"). */
  label?: string;
  /** The terminal's width; the in-place line is cut to fit it. */
  columns?: number;
  /** In a terminal, turn a spinner and fill a bar, in these colours. */
  motion?: Colorizer | undefined;
};

export type Progress = {
  tick(): void;
  done(): void;
};

const COUNT_THRESHOLD = 50;
const TIME_THRESHOLD_MS = 250;
const LOG_INTERVAL_MS = 10_000;

/** Braille frames a spinner turns through, one per redraw. */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_MS = 80;
const BAR_MAX = 30;
const BAR_MIN = 10;

/** `text` cut to fit a terminal `columns` wide, leaving the last column free so the line never wraps. */
function fit(text: string, columns: number | undefined): string {
  return columns !== undefined && columns > 1 && text.length >= columns ? text.slice(0, columns - 1) : text;
}

/** Calls `draw` every frame until the returned function stops it. The timer never keeps the process running. */
function everyFrame(draw: () => void): () => void {
  const timer = setInterval(draw, FRAME_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/** `text` cut to fit, its first character (the spinner) in the brand colour. */
function spun(color: Colorizer, text: string, columns: number | undefined): string {
  const line = fit(text, columns);
  return `${color.brand(line.slice(0, 1))}${line.slice(1)}`;
}

/** A bar `width` cells wide, filled to `fraction` in heavy brand-coloured rule, in half cells, the rest a dim hairline. */
function bar(color: Colorizer, fraction: number, width: number): string {
  const cells = Math.max(0, Math.min(1, fraction)) * width;
  const full = Math.floor(cells);
  const half = full < width && cells - full >= 0.5 ? "╸" : "";
  return `${color.brand(`${"━".repeat(full)}${half}`)}${color.dim("─".repeat(width - full - half.length))}`;
}

/**
 * A counter through `total` items. In a terminal it redraws every 50 ticks or
 * 250ms, and always on the last tick. In a log it writes the first tick, then
 * at most one line every 10 seconds.
 */
export function createProgress(opts: ProgressOptions): Progress {
  const start = Date.now();
  let processed = 0;
  let lastEmitCount = -1; // forces emission on the first tick
  let lastEmitTime = 0;
  let frame = 0;
  let stopFrames: (() => void) | undefined;

  const label = opts.label ?? "Reading files";

  /** The line with a spinner, the bar when the terminal has room for it, the count and the time. */
  function animated(color: Colorizer, elapsedS: string, body: string): string {
    const spinner = SPINNER[frame++ % SPINNER.length] as string;
    const count = `${processed} of ${opts.total}`;
    const tail = `${opts.total > 0 ? Math.floor((processed / opts.total) * 100) : 0}%  ${elapsedS}s`;
    const room = (opts.columns ?? 80) - 1 - `${spinner} ${label}    ${count}  ${tail}`.length;
    if (room < BAR_MIN) return spun(color, `${spinner} ${body}`, opts.columns);
    const width = Math.min(BAR_MAX, room);
    return `${color.brand(spinner)} ${label}  ${bar(color, opts.total > 0 ? processed / opts.total : 0, width)}  ${color.bold(count)}  ${color.dim(tail)}`;
  }

  function draw() {
    const pct = opts.total > 0 ? ((processed / opts.total) * 100).toFixed(1) : "0.0";
    const elapsedS = ((Date.now() - start) / 1000).toFixed(1);
    const body = `${label}: ${processed} of ${opts.total} (${pct}%), ${elapsedS}s`;
    if (!opts.isTTY) opts.writer(`${body}\n`);
    else if (opts.motion === undefined) opts.writer(`\r${fit(body, opts.columns)}\x1b[K`);
    else opts.writer(`\r${animated(opts.motion, elapsedS, body)}\x1b[K`);
  }

  function emit() {
    draw();
    if (opts.isTTY && opts.motion !== undefined) stopFrames ??= everyFrame(draw);
    lastEmitCount = processed;
    lastEmitTime = Date.now();
  }

  return {
    tick() {
      processed += 1;
      if (lastEmitCount === -1) {
        emit();
        return;
      }
      const elapsedSinceEmit = Date.now() - lastEmitTime;
      if (!opts.isTTY) {
        if (elapsedSinceEmit >= LOG_INTERVAL_MS) emit();
        return;
      }
      // sinceEmit counts the current tick, so the COUNT_THRESHOLDth tick since
      // the last emit fires this branch (e.g. with threshold 50: emit at the
      // 1st tick, then at the 50th, 99th, …).
      const sinceEmit = processed - lastEmitCount;
      if (sinceEmit >= COUNT_THRESHOLD - 1 || elapsedSinceEmit >= TIME_THRESHOLD_MS || processed === opts.total) {
        emit();
      }
    },
    done() {
      stopFrames?.();
      if (opts.isTTY && lastEmitCount > 0) {
        opts.writer("\r\x1b[K");
      }
    },
  };
}

export type PhaseOptions = {
  label: string;
  writer: (s: string) => void;
  isTTY: boolean;
  /** The terminal's width; the in-place line is cut to fit it. */
  columns?: number;
  /** In a terminal, turn a spinner before the label, in these colours. */
  motion?: Colorizer | undefined;
};

/**
 * A phase with no count: its label once in a log, or in place in a terminal until `done` clears it. With motion, a
 * spinner turns before the label while the process is free to redraw it.
 */
export function startPhase(opts: PhaseOptions): { done(): void } {
  const { motion } = opts;
  if (!opts.isTTY || motion === undefined) {
    opts.writer(opts.isTTY ? `\r${fit(opts.label, opts.columns)}\x1b[K` : `${opts.label}\n`);
    return {
      done() {
        if (opts.isTTY) opts.writer("\r\x1b[K");
      },
    };
  }
  let frame = 0;
  const draw = () => opts.writer(`\r${spun(motion, `${SPINNER[frame++ % SPINNER.length]} ${opts.label}`, opts.columns)}\x1b[K`);
  draw();
  const stopFrames = everyFrame(draw);
  return {
    done() {
      stopFrames();
      opts.writer("\r\x1b[K");
    },
  };
}
