type Release = () => void;

let active = 0;
const waiters = new Set<() => void>();

function takeSlot(): Release {
  active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
    waiters.values().next().value?.();
  };
}

export function acquireScanUploadSlot(signal: AbortSignal, options: { slots: number; waitMs: number }): Promise<Release | null> {
  if (signal.aborted) return Promise.resolve(null);
  if (active < options.slots) return Promise.resolve(takeSlot());

  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", giveUp);
      waiters.delete(admit);
    };
    const admit = () => {
      cleanup();
      resolve(takeSlot());
    };
    const giveUp = () => {
      cleanup();
      resolve(null);
    };
    const timer = setTimeout(giveUp, options.waitMs);
    waiters.add(admit);
    signal.addEventListener("abort", giveUp, { once: true });
  });
}
