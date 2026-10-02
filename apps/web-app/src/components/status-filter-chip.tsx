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
 * The owner decides whether the chip exists; the chip itself always renders.
 */
export function StatusFilterChip({
  icon: Icon,
  tone,
  label,
  count,
  total,
  maxCount,
  active,
  onToggle,
  className,
}: {
  icon: LucideIcon;
  tone: "warn" | "neutral";
  label: string;
  count: number;
  total?: number | undefined;
  /** The largest count the chip can show; the count text is padded to its width. */
  maxCount?: number | undefined;
  active: boolean;
  onToggle: () => void;
  className?: string | undefined;
}) {
  const shown = count.toLocaleString();
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={count <= 0 && !active}
      onClick={onToggle}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        active ? PRESSED[tone] : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {label}
      <span
        className="tabular-nums"
        style={maxCount === undefined ? undefined : { paddingRight: `${maxCount.toLocaleString().length - shown.length}ch` }}
      >
        {shown}
        {total !== undefined ? ` of ${total.toLocaleString()}` : null}
      </span>
    </button>
  );
}
