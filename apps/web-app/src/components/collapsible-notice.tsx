import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** A notice closed to one summary line that opens to its details: what a scan couldn't see, or what a chart leaves out. */
export function CollapsibleNotice({ icon, summary, children }: { icon: ReactNode; summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group rounded-md border border-border bg-accent/40 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 [&::-webkit-details-marker]:hidden">
        {icon}
        <span className="flex flex-wrap items-baseline gap-x-1.5">{summary}</span>
        <ChevronDown aria-hidden className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <ul className="divide-y divide-border border-t border-border">{children}</ul>
    </details>
  );
}

/** One row of an open `CollapsibleNotice`, its text lined up with the summary's. */
export function CollapsibleNoticeRow({ children }: { children: ReactNode }) {
  return <li className="space-y-1 px-3 py-2.5 sm:pl-[2.125rem]">{children}</li>;
}
