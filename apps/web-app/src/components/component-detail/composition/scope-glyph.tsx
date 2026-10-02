import { cn } from "@/lib/utils";

/**
 * Scope marker: a filled dot for external, a hollow ring for local, so shape
 * as well as colour tells them apart. Always aria-hidden; nearby text or an
 * aria-label carries the word.
 */
export function ScopeGlyph({
  scope,
  className,
}: {
  scope: "external" | "local";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        scope === "external" ? "bg-viz-primary" : "border-[1.5px] border-viz-legacy",
        className,
      )}
    />
  );
}
