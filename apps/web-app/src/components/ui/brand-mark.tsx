import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-[7px] ring-1 ring-border bg-background",
        className,
      )}
    >
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative mark; parent span carries aria-hidden */}
      <svg viewBox="0 0 16 16" className="size-4" fill="none">
        {/* Compass needle: two opposed triangles on the N-S axis, the north
            half filled, the south half outlined. */}
        <path d="M8 1.4 L10 8 L8 8 L6 8 Z" fill="var(--foreground)" />
        <path d="M8 14.6 L6 8 L8 8 L10 8 Z" fill="none" stroke="var(--muted-foreground)" strokeWidth="0.9" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
