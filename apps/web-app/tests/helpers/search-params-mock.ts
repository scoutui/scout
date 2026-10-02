import { useEffect, useState } from "react";

/**
 * Reactive `useSearchParams` module mock for `vi.mock("next/navigation", …)`.
 *
 * Real Next.js patches window.history.replaceState/pushState and listens for
 * popstate, so useSearchParams consumers re-render on a raw history write or
 * Back, not just a router.push/replace call. This does the same, so a
 * fireEvent.change re-filters synchronously.
 *
 * vi.mock factories are hoisted, so consumers must load this lazily:
 *
 *   vi.mock("next/navigation", async () =>
 *     (await import("../helpers/search-params-mock")).searchParamsNavigationMock(),
 *   );
 */
export function searchParamsNavigationMock() {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const replaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = (...args: Parameters<typeof replaceState>) => {
    replaceState(...args);
    notify();
  };
  const pushState = window.history.pushState.bind(window.history);
  window.history.pushState = (...args: Parameters<typeof pushState>) => {
    pushState(...args);
    notify();
  };
  window.addEventListener("popstate", notify);
  return {
    useSearchParams: () => {
      const [, forceRender] = useState(0);
      useEffect(() => {
        const listener = () => forceRender((n) => n + 1);
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }, []);
      return new URLSearchParams(window.location.search);
    },
  };
}
