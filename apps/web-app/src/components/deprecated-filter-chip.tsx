"use client";
import { AlertTriangle } from "lucide-react";
import { StatusFilterChip } from "@/components/status-filter-chip";

/**
 * The "show only what's deprecated" toggle, shared by the repo components,
 * packages and package components tables.
 *
 * There is no "only not deprecated" state. `deprecated:false` still parses from
 * a pasted URL and can be removed with its pill; it just has no control of its
 * own.
 */
export function DeprecatedFilterChip({
  count,
  total,
  maxCount,
  active,
  onToggle,
  className,
}: {
  count: number;
  total?: number | undefined;
  maxCount?: number | undefined;
  active: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <StatusFilterChip
      icon={AlertTriangle}
      tone="warn"
      label="deprecated"
      count={count}
      total={total}
      maxCount={maxCount}
      active={active}
      onToggle={onToggle}
      className={className}
    />
  );
}
