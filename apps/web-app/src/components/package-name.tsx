"use client";
import { useRef } from "react";
import { useElementWidth } from "./component-detail/usage/usage-layout-hooks";

/**
 * A package's name in the monospace face, its scope faint. Where the whole name doesn't fit, the scope reads `@…`, and
 * a name still too long is cut at the end. A hidden copy of the whole name measures what it needs.
 */
export function PackageName({ name }: { name: string }) {
  const boxRef = useRef<HTMLSpanElement | null>(null);
  const wholeRef = useRef<HTMLSpanElement | null>(null);
  const room = useElementWidth(boxRef);
  const needed = useElementWidth(wholeRef);
  const slash = name.startsWith("@") ? name.indexOf("/") : -1;
  if (slash < 0) return <span className="block min-w-0 truncate font-mono">{name}</span>;
  return (
    <span ref={boxRef} className="relative flex min-w-0 overflow-hidden font-mono">
      <span ref={wholeRef} aria-hidden="true" className="invisible absolute whitespace-pre">
        {name}
      </span>
      <span className="shrink-0 text-faint">{needed <= room ? name.slice(0, slash) : "@…"}</span>
      <span className="min-w-0 truncate">{name.slice(slash)}</span>
    </span>
  );
}
