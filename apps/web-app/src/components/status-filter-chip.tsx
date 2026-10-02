"use client";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// The tone colours only the pressed state; idle chips all share one outline.
// Pressed keeps the idle font weight, since bolder text would widen the chip
// and shift the controls after it.
const PRESSED = {
  warn: "border-status-warn-border bg-status-warn-tint text-status-warn-text",
  neutral: "selected text-foreground",
} as const;

/**
 * A status toggle (deprecated in use, moved since the last scan) beside a
 * table's `+ Filter` trigger: icon, word and count, with `aria-pressed`.
 * Renders nothing at zero unless pressed: counts follow the other filters, and
 * a pressed chip they bring to 0 must stay so it can be unpressed.
 */
export function StatusFilterChip({
  icon: Icon,
  tone,
  label,
  count,
  maxCount,
  active,
  onToggle,
  className,
}: {
  icon: LucideIcon;
  tone: "warn" | "neutral";
  label: string;
  count: number;
  /** The largest count this chip can show. The count reserves that many
   *  characters, so a filter change never changes the chip's width. */
  maxCount?: number | undefined;
  active: boolean;
  onToggle: () => void;
  className?: string | undefined;
}) {
  if (count <= 0 && !active) return null;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? PRESSED[tone] : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {label}
      <span
        className="tabular-nums"
        style={maxCount === undefined ? undefined : { minWidth: `${maxCount.toLocaleString().length}ch` }}
      >
        {count.toLocaleString()}
      </span>
    </button>
  );
}
