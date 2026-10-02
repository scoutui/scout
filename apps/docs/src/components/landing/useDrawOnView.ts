import { type RefObject, useEffect, useRef, useState } from "react";

type DrawState = "armed" | "run" | undefined;

/**
 * Draws a chart once, left to right, when half of it has scrolled into view, as the web app draws its charts when
 * they load. Put `ref` on the figure and `state` in its `data-draw`, then mark the series with `shared.drawn` and
 * the labels that follow them with `shared.afterDraw`. The chart stays fully drawn without JavaScript, under
 * reduced motion, and when it is already on screen as the page loads.
 */
export default function useDrawOnView<T extends HTMLElement>(): { ref: RefObject<T | null>; state: DrawState } {
  const ref = useRef<T>(null);
  const [state, setState] = useState<DrawState>();

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    setState("armed");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry || entry.intersectionRatio < 0.5) return;
        setState("run");
        observer.disconnect();
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, state };
}
