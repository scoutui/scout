import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom lacks PointerEvent; Base UI's Checkbox/Popover constructs one internally.
// Only patch when MouseEvent exists (i.e. jsdom env, not node-env api tests).
if (typeof globalThis.MouseEvent !== "undefined" && typeof globalThis.PointerEvent === "undefined") {
  class PolyfillPointerEvent extends globalThis.MouseEvent {}
  globalThis.PointerEvent = PolyfillPointerEvent as unknown as typeof PointerEvent;
}

// jsdom lacks ResizeObserver, which @tanstack/react-virtual uses to observe the
// scroll element for size changes. A no-op is enough; the size comes from the
// offset* stub below.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom has no layout, so offset* are 0. @tanstack/virtual-core sizes its scroll
// viewport and rows from offsetWidth/offsetHeight, so stub a non-zero box, or a
// virtualized table renders zero rows.
if (typeof globalThis.HTMLElement !== "undefined") {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 1000;
    },
  });
}

// jsdom lacks matchMedia, which the theme provider (dark-mode detection) and
// several components (prefers-reduced-motion checks) call on mount/effect.
// A static "no preference matched" stub is enough for components that only
// read `.matches` and (de)register a change listener.
if (typeof globalThis.window !== "undefined" && typeof globalThis.window.matchMedia === "undefined") {
  globalThis.window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
});
