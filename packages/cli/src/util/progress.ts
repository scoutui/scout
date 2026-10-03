/**
 * Progress for the scan's phases, written to stderr. In a terminal, one line
 * rewritten in place, cut to the terminal's width so it never wraps. In a log
 * (CI), whole lines, few enough that the log stays readable.
 */

export type ProgressOptions = {
  total: number;
  writer: (s: string) => void;
  isTTY: boolean;
  /** The text before the colon in the rendered line (default: "Reading files"). */
  label?: string;
  /** The terminal's width; the in-place line is cut to fit it. */
  columns?: number;
};

export type Progress = {
  tick(): void;
  done(): void;
};

const COUNT_THRESHOLD = 50;
const TIME_THRESHOLD_MS = 250;
const LOG_INTERVAL_MS = 10_000;

/** `text` cut to fit a terminal `columns` wide, leaving the last column free so the line never wraps. */
function fit(text: string, columns: number | undefined): string {
  return columns !== undefined && columns > 1 && text.length >= columns ? text.slice(0, columns - 1) : text;
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

  const label = opts.label ?? "Reading files";

  function emit() {
    const pct = opts.total > 0 ? ((processed / opts.total) * 100).toFixed(1) : "0.0";
    const elapsedS = ((Date.now() - start) / 1000).toFixed(1);
    const body = `${label}: ${processed} of ${opts.total} (${pct}%), ${elapsedS}s`;
    if (opts.isTTY) {
      opts.writer(`\r${fit(body, opts.columns)}\x1b[K`);
    } else {
      opts.writer(`${body}\n`);
    }
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
};

/** A phase with no count: its label once in a log, or in place in a terminal until `done` clears it. */
export function startPhase(opts: PhaseOptions): { done(): void } {
  opts.writer(opts.isTTY ? `\r${fit(opts.label, opts.columns)}\x1b[K` : `${opts.label}\n`);
  return {
    done() {
      if (opts.isTTY) opts.writer("\r\x1b[K");
    },
  };
}
