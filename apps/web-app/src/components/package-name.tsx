import type { CSSProperties } from "react";

/**
 * A package's name in the monospace face, its scope faint. Where the whole name doesn't fit its box, the scope reads
 * `@…`, and a name still too long is cut at the end. CSS picks the form from the name's length in characters. The box
 * takes its width from where it sits, such as a grid cell, not from the name.
 */
export function PackageName({ name }: { name: string }) {
  const slash = name.startsWith("@") ? name.indexOf("/") : -1;
  if (slash < 0) return <span className="block min-w-0 truncate font-mono">{name}</span>;
  return (
    <span className="@container flex min-w-0 font-mono" style={{ "--chars": name.length } as CSSProperties}>
      <span className="if-name-fits shrink-0 text-faint">{name.slice(0, slash)}</span>
      <span aria-hidden className="if-name-overflows shrink-0 text-faint">@…</span>
      <span className="min-w-0 truncate">{name.slice(slash)}</span>
    </span>
  );
}
