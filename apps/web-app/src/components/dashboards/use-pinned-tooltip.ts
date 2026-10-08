"use client";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

const stop = (event: Event) => event.stopPropagation();

/**
 * Pins a chart over time's tooltip at a scan. A click or tap while the tooltip shows a scan pins it there, and so does
 * Enter on the focused plot, at the scan the arrow keys reached. A second click or Enter, Escape, or a press outside the chart unpins it, while
 * clicks in the pinned tooltip stay there. `ref` and `onKeyDown` go on the chart's container and `onClick` on the
 * chart; while `pinned`, the tooltip's `trigger` is `"click"`.
 */
export function usePinnedTooltip() {
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pinned) return;
    const tooltip = ref.current?.querySelector(".recharts-tooltip-wrapper");
    const outside = (event: Event) => {
      if (!(event.target instanceof Node && ref.current?.contains(event.target))) setPinned(false);
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    tooltip?.addEventListener("click", stop);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", onEscape);
    return () => {
      tooltip?.removeEventListener("click", stop);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [pinned]);
  return {
    pinned,
    ref,
    onClick: () => {
      const showing = ref.current?.querySelector(".recharts-tooltip-cursor") != null;
      setPinned((was) => !was && showing);
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const cursor = ref.current?.querySelector(".recharts-tooltip-cursor");
      if (event.key !== "Enter" || !(event.target instanceof Element && event.target.matches(".recharts-surface")) || !cursor) return;
      const box = cursor.getBoundingClientRect();
      cursor.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
    },
  };
}
