"use client";
import { useLayoutEffect, useRef, useState } from "react";

type Pt = { x: number; y: number };

/** A horizontal S-curve from a to b. */
export const curve = (a: Pt, b: Pt) => {
  const dx = Math.max(12, (b.x - a.x) / 2);
  return `M${a.x} ${a.y}C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`;
};

/** An open arrowhead whose tip is at `tip`, pointing right or down. */
export const head = (tip: Pt, dir: "right" | "down") =>
  dir === "right"
    ? `M${tip.x - 5} ${tip.y - 3.5}L${tip.x} ${tip.y}L${tip.x - 5} ${tip.y + 3.5}`
    : `M${tip.x - 3.5} ${tip.y - 5}L${tip.x} ${tip.y}L${tip.x + 3.5} ${tip.y - 5}`;

/** A line from one `data-anchor` to another: across to the next column, or down to the next route box. */
export type Segment = { from: string; to: string; dir: "right" | "down" };

export type Lines = {
  /** Rows whose lines merge into one trunk with one head at this component's box, and the lit one. */
  fanIn: { anchors: string[]; lit: string | null };
  /** Rows one trunk from this component's box branches out to, each with a head, and the lit one. */
  fanOut: { anchors: string[]; lit: string | null };
  /** The route's lines, all lit. */
  route: Segment[];
};

type Drawn = { d: string; lit: boolean };

/** How far the trunks reach out from this component's box. */
const TRUNK = 16;

function measure(container: HTMLElement, lines: Lines): Drawn[] {
  const origin = container.getBoundingClientRect();
  const anchors = new Map<string, HTMLElement>();
  for (const el of container.querySelectorAll<HTMLElement>("[data-anchor]")) {
    anchors.set(el.getAttribute("data-anchor") ?? "", el);
  }
  /** A point on an anchor's edge. A row's sides are its list's sides; a row
   *  scrolled out of its list is hidden, its point held at the list's edge. */
  const end = (anchor: string, side: "left" | "right" | "top" | "bottom") => {
    const el = anchors.get(anchor);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const sides = el.closest("[data-panel]")?.getBoundingClientRect() ?? r;
    let y = (r.top + r.bottom) / 2;
    let hidden = false;
    const scroller = el.closest("[data-scroller]")?.getBoundingClientRect();
    if (scroller && (y < scroller.top || y > scroller.bottom)) {
      hidden = true;
      y = Math.min(Math.max(y, scroller.top), scroller.bottom);
    }
    const x = side === "left" ? sides.left : side === "right" ? sides.right : (r.left + r.right) / 2;
    if (side === "top") y = r.top;
    if (side === "bottom") y = r.bottom;
    return { x: x - origin.left, y: y - origin.top, hidden };
  };

  const drawn: Drawn[] = [];
  const left = end("focus", "left");
  const right = end("focus", "right");
  if (left && right) {
    const join = { x: left.x - TRUNK, y: left.y };
    for (const anchor of lines.fanIn.anchors) {
      const a = end(anchor, "right");
      const lit = anchor === lines.fanIn.lit;
      if (a && (lit || !a.hidden)) drawn.push({ d: curve(a, join), lit });
    }
    if (lines.fanIn.anchors.length > 0) {
      drawn.push({ d: `M${join.x} ${join.y}H${left.x}${head(left, "right")}`, lit: lines.fanIn.lit !== null });
    }
    const split = { x: right.x + TRUNK, y: right.y };
    if (lines.fanOut.anchors.length > 0) {
      drawn.push({ d: `M${right.x} ${right.y}H${split.x}`, lit: lines.fanOut.lit !== null });
    }
    for (const anchor of lines.fanOut.anchors) {
      const b = end(anchor, "left");
      const lit = anchor === lines.fanOut.lit;
      if (b && (lit || !b.hidden)) drawn.push({ d: `${curve(split, b)}${head(b, "right")}`, lit });
    }
  }
  for (const s of lines.route) {
    const a = end(s.from, s.dir === "right" ? "right" : "bottom");
    const b = end(s.to, s.dir === "right" ? "left" : "top");
    if (!a || !b) continue;
    drawn.push({
      d: s.dir === "right" ? `${curve(a, b)}${head(b, "right")}` : `M${a.x} ${a.y}V${b.y}${head({ x: a.x, y: b.y }, "down")}`,
      lit: true,
    });
  }
  return drawn.sort((a, b) => Number(a.lit) - Number(b.lit));
}

/**
 * The lines between the diagram's lists and boxes, drawn over its parent
 * from where each `data-anchor` sits, and redrawn when anything moves.
 */
export function Connectors({ lines }: { lines: Lines }) {
  const [drawn, setDrawn] = useState<Drawn[]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  useLayoutEffect(() => {
    const container = svgRef.current?.parentElement;
    if (!container) return;
    let frame = 0;
    const redraw = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setDrawn(measure(container, lines));
      });
    };
    setDrawn(measure(container, lines));
    container.addEventListener("scroll", redraw, { capture: true, passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(redraw);
    if (resize) {
      resize.observe(container);
      for (const el of container.querySelectorAll("[data-panel], [data-scroller] > *, ol")) resize.observe(el);
    }
    let live = true;
    if ("fonts" in document) {
      void document.fonts.ready.then(() => {
        if (live) redraw();
      });
    }
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      container.removeEventListener("scroll", redraw, { capture: true });
      resize?.disconnect();
    };
  }, [lines]);
  return (
    <svg
      ref={svgRef}
      data-connectors
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {drawn.map((p, i) => (
        <path
          // biome-ignore lint/suspicious/noArrayIndexKey: redrawn whole on every change
          key={i}
          d={p.d}
          stroke={p.lit ? "var(--foreground)" : "var(--faint)"}
          strokeWidth={p.lit ? 1.5 : 1.25}
        />
      ))}
    </svg>
  );
}
