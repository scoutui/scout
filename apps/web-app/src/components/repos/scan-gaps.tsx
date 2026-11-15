"use client";
import { type ReactNode, useId, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The repo header's status line. When the scan couldn't see everything it ends
 * with "Some uses may be missing" and a "See N gaps" button that shows the
 * gaps, one row per kind, below the line.
 */
export function StatusLine({ children, gapCount, gaps }: { children: ReactNode; gapCount: number; gaps: ReactNode }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {children}
        {gapCount > 0 ? (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Info aria-hidden className="size-3.5 shrink-0 text-status-warn" />
              Some uses may be missing
            </span>
            <Button variant="outline" size="xs" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)} className="group font-normal">
              See {gapCount.toLocaleString()} {gapCount === 1 ? "gap" : "gaps"}
              <ChevronDown aria-hidden className="text-muted-foreground transition-transform duration-150 ease-out group-aria-expanded:rotate-180 motion-reduce:transition-none" />
            </Button>
          </span>
        ) : null}
      </div>
      {gapCount > 0 ? (
        <ul id={listId} hidden={!open} aria-label="What this scan couldn't see" className="divide-y divide-border rounded-md border border-border bg-accent/40 text-xs">
          {gaps}
        </ul>
      ) : null}
    </>
  );
}
