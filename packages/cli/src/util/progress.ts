/**
 * Rate-limited progress reporter for the scan loop. Writes one line to
 * stderr, rewritten in place on a TTY and appended per emit otherwise (CI logs).
 *
 * Emits every 50 ticks or 250ms, whichever comes first, so the line moves
 * smoothly on a TTY without flooding non-TTY logs.
 */

export type ProgressOptions = {
  total: number;
  writer: (s: string) => void;
  isTTY: boolean;
  /** The text before the colon in the rendered line (default: "Reading files"). */
  label?: string;
};

export type Progress = {
  tick(): void;
  done(): void;
};

const COUNT_THRESHOLD = 50;
const TIME_THRESHOLD_MS = 250;

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
      opts.writer(`\r${body}\x1b[K`);
    } else {
      opts.writer(`${body}\n`);
    }
    lastEmitCount = processed;
    lastEmitTime = Date.now();
  }

  return {
    tick() {
      processed += 1;
      // sinceEmit counts the current tick, so the COUNT_THRESHOLDth tick since
      // the last emit fires this branch (e.g. with threshold 50: emit at the
      // 1st tick, then at the 50th, 99th, …). Always emit on the final tick
      // so the bar shows 100% before the next phase starts.
      const sinceEmit = processed - lastEmitCount;
      const elapsedSinceEmit = Date.now() - lastEmitTime;
      if (
        lastEmitCount === -1 ||
        sinceEmit >= COUNT_THRESHOLD - 1 ||
        elapsedSinceEmit >= TIME_THRESHOLD_MS ||
        processed === opts.total
      ) {
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
