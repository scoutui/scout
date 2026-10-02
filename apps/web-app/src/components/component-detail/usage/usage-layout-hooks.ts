"use client";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/** Whether the page matches a media query. False until mounted. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useLayoutEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** An element's width inside its borders, measured again as it resizes. 0 until mounted. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** The width of one character of an element's text, measured again as it resizes, such as when its font loads. 0 until mounted. */
export function useCharWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width / Math.max(1, el.textContent?.length ?? 1));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * Sets `--pin-top` on `root` to the height of the page's sticky top nav, where the file toolbar pins, and `--bar-h` to
 * the toolbar's height while it's sticky, where the table headings pin below it.
 */
export function usePinTop(root: RefObject<HTMLElement | null>, bar: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const nav = [...document.querySelectorAll("nav")].find((n) => getComputedStyle(n).position === "sticky") ?? null;
    const update = () => {
      el.style.setProperty("--pin-top", `${nav?.getBoundingClientRect().height ?? 0}px`);
      const stuck = bar.current && getComputedStyle(bar.current).position === "sticky" ? bar.current : null;
      el.style.setProperty("--bar-h", `${stuck?.getBoundingClientRect().height ?? 0}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    for (const n of [nav, bar.current, el]) if (n) observer.observe(n);
    return () => observer.disconnect();
  }, [root, bar]);
}

/** Where the file toolbar sits once it has pinned: its own top while pinned, else the top it pins at. */
export function pinLine(bar: HTMLElement): number {
  const top = bar.getBoundingClientRect().top;
  const pinsAt = Number.parseFloat(getComputedStyle(bar).top);
  return Number.isFinite(pinsAt) ? Math.min(top, pinsAt) : top;
}

/**
 * While `on`, keeps the column beside the files in view as the page scrolls. A column that fits under the pin line,
 * where the file toolbar pins, holds at the pin line. A taller one moves with the page until its bottom reaches the
 * window's bottom and holds there, and on the way back up moves with the page until its top reaches the pin line and
 * holds there.
 *
 * The column is sticky, and the spacer above it in its grid area sets where it sits in the page, so between the two
 * limits the browser moves it with the page. Scrolling down, only the lower limit applies: the column holds once its
 * bottom reaches the window's bottom, or at the pin line if it fits. Scrolling up, only the upper one does: it holds
 * once its top reaches the pin line. When the direction turns, the spacer is set to where the column is on screen, moved
 * by that first step if the column was holding at a limit, and the other limit takes over.
 *
 * When the column changes height, the row or field last pressed or typed in stays where it was on screen, or, when that
 * row has gone, the row focus moved to in its place, unless the page has scrolled since. When the column can't move far
 * enough to put that row there, the page scrolls just enough to show it. A column that this leaves above the pin line
 * holds there scrolling down, until scrolling up brings it back. It also sets `--column-pin` for what pins inside it.
 *
 * While on, `scrollByRef` scrolls the page for a change above the window, keeping the column where it is on screen.
 */
export function useStickyColumn(
  on: boolean,
  columnRef: RefObject<HTMLElement | null>,
  spacerRef: RefObject<HTMLElement | null>,
  barRef: RefObject<HTMLElement | null>,
  filesRef: RefObject<HTMLElement | null>,
  scrollByRef: RefObject<((dy: number) => void) | null>,
): void {
  // Runs after every render of the page, before the browser acts on it, so a field that was typed in is back in place
  // before the browser would scroll the page to show it.
  const settle = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    settle.current?.();
  });
  useEffect(() => {
    const column = columnRef.current;
    const spacer = spacerRef.current;
    const bar = barRef.current;
    const files = filesRef.current;
    const area = spacer?.parentElement;
    if (!on || !column || !spacer || !bar || !files || !area) return;
    let down = true;
    let lastY = window.scrollY;
    // Set while the column sits above where scrolling down would hold it, after keeping a pressed row in place.
    let lifted = false;
    // `focused` had focus when `el` was pressed. A clicked button doesn't always take focus, so a row counts as focused
    // in the pressed row's place only once focus has moved since.
    let anchor: { el: HTMLElement; top: number; y: number; at: number; focused: Element | null } | null = null;

    const pin = () => Number.parseFloat(getComputedStyle(bar).top) || 0;
    const viewH = () => document.documentElement.clientHeight;
    // The files' own height: the grid stretches their box to the row, which the spacer could otherwise lengthen.
    const filesH = () => (files.lastElementChild?.getBoundingClientRect().bottom ?? 0) - files.getBoundingClientRect().top;

    /** Puts the column's top at `top` on screen, as far as its grid area allows, under the limit for this direction. */
    const place = (top: number) => {
      const p = pin();
      const h = column.getBoundingClientRect().height;
      const areaTop = area.getBoundingClientRect().top;
      const offset = Math.min(Math.max(0, filesH() - h), Math.max(0, top - areaTop));
      spacer.style.height = `${offset}px`;
      const lowest = Math.min(p, viewH() - h);
      if (lifted && top >= lowest - 0.5) lifted = false;
      if (down) {
        column.style.top = `${lifted ? Math.min(lowest, top) : lowest}px`;
        column.style.bottom = "auto";
      } else {
        column.style.top = "auto";
        column.style.bottom = `${viewH() - p - h}px`;
      }
      column.style.setProperty("--column-pin", `${p}px`);
    };

    const onScroll = () => {
      const y = window.scrollY;
      const step = lastY - y;
      const turned = step < 0 ? !down : step > 0 ? down : false;
      lastY = y;
      if (!turned) return;
      const top = column.getBoundingClientRect().top;
      // A column held at its limit sat out this first step the other way, however long; it takes the step here, so it
      // is where it would be had it moved with the page from the turn.
      const held = Math.abs(top - (down ? Number.parseFloat(column.style.top) : pin())) < 1;
      down = !down;
      place(held ? top + step : top);
    };

    // The row or field about to change the column, and where it is on screen, before the change renders.
    const remember = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("button, input");
      anchor = el ? { el, top: el.getBoundingClientRect().top, y: window.scrollY, at: performance.now(), focused: document.activeElement } : null;
    };

    // Where an element in the column would be on screen if nothing in it were pinned. A field in the pinned heading is
    // read from where the heading's own place ends, the top of the list after it.
    const unpinnedTop = (el: HTMLElement) => {
      const top = el.getBoundingClientRect().top;
      const pinned = el.closest<HTMLElement>("[data-column-pinned]");
      const next = pinned?.nextElementSibling;
      if (!pinned || !next) return top;
      const box = pinned.getBoundingClientRect();
      return next.getBoundingClientRect().top - box.height + (top - box.top);
    };

    // After the column may have changed height: moves it so the remembered row or field is back where it was, with the
    // column laid out under it as if nothing were pinned, so a filtered list shows below Find a prop. A remembered row
    // that has gone gives way to the column's focused row, which the tab focuses in its place.
    const resized = () => {
      const a = anchor;
      const focused = document.activeElement;
      let followed = false;
      if (a && !a.el.isConnected && focused instanceof HTMLElement && focused !== a.focused && column.contains(focused)) {
        a.el = focused;
        followed = true;
      }
      if (!a || !a.el.isConnected || !column.contains(a.el) || a.y !== window.scrollY || performance.now() - a.at > 1000) {
        place(column.getBoundingClientRect().top);
        return;
      }
      const top = column.getBoundingClientRect().top + a.top - unpinnedTop(a.el);
      if (down && top < Math.min(pin(), viewH() - column.getBoundingClientRect().height) - 0.5) lifted = true;
      place(top);
      if (followed && Math.abs(a.el.getBoundingClientRect().top - a.top) > 1) a.el.scrollIntoView({ block: "nearest", behavior: "instant" });
    };

    place(column.getBoundingClientRect().top);
    window.addEventListener("scroll", onScroll, { passive: true });
    const onResize = () => {
      lifted = false;
      place(column.getBoundingClientRect().top);
    };
    window.addEventListener("resize", onResize);
    for (const type of ["pointerdown", "keydown", "click", "input"]) column.addEventListener(type, remember, true);
    settle.current = resized;
    scrollByRef.current = (dy) => {
      const top = column.getBoundingClientRect().top;
      window.scrollBy({ top: dy, behavior: "instant" });
      // Not the reader's scroll, so it neither turns the column's direction nor moves it.
      lastY = window.scrollY;
      place(top);
    };
    const observer = new ResizeObserver(resized);
    observer.observe(column);
    observer.observe(files);
    return () => {
      settle.current = null;
      scrollByRef.current = null;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      for (const type of ["pointerdown", "keydown", "click", "input"]) column.removeEventListener(type, remember, true);
      observer.disconnect();
      spacer.style.removeProperty("height");
      column.style.removeProperty("top");
      column.style.removeProperty("bottom");
      column.style.removeProperty("--column-pin");
    };
  }, [on, columnRef, spacerRef, barRef, filesRef, scrollByRef]);
}

/**
 * Keeps the page still when the filter pill strip changes height while it's under the pinned toolbar or above the
 * window, as when a filter is removed with the list scrolled down: the page scrolls by the change, so what's in view
 * stays where it was. `scrollByRef` scrolls instead of the window when it's set.
 */
export function useSteadyStrip(stripRef: RefObject<HTMLElement | null>, barRef: RefObject<HTMLElement | null>, scrollByRef: RefObject<((dy: number) => void) | null>): void {
  useEffect(() => {
    const strip = stripRef.current;
    const bar = barRef.current;
    if (!strip || !bar) return;
    let height = strip.getBoundingClientRect().height;
    const observer = new ResizeObserver(() => {
      const next = strip.getBoundingClientRect().height;
      const change = next - height;
      height = next;
      // The toolbar's bottom while it's pinned; the top nav's when it scrolls with the page.
      const line = Math.max(bar.getBoundingClientRect().bottom, Number.parseFloat(getComputedStyle(bar).getPropertyValue("--pin-top")) || 0);
      if (!change || strip.getBoundingClientRect().top >= line - 0.5) return;
      if (scrollByRef.current) scrollByRef.current(change);
      else window.scrollBy({ top: change, behavior: "instant" });
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [stripRef, barRef, scrollByRef]);
}

/** Whether a key press is typing into a field or held with a modifier, which single-key shortcuts leave alone. */
export function typing(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  return Boolean(target?.closest("input, textarea, select, [contenteditable]")) || e.metaKey || e.ctrlKey || e.altKey;
}

/**
 * Below lg, where the column folds above the files: opens it, scrolls its top to the pin line at once, and focuses its
 * Find a prop, or its first control when there's no Find a prop.
 */
export function showColumn(column: HTMLElement | null, open: () => void): void {
  flushSync(open);
  if (!column) return;
  column.scrollIntoView({ block: "start", behavior: "instant" });
  (document.getElementById("usage-find-prop") ?? document.getElementById("usage-column-body")?.querySelector<HTMLElement>("button, input, a[href]"))?.focus({ preventScroll: true });
}
