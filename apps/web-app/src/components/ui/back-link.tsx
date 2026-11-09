import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** The link above a detail page's title, back to the page it sits under. `code` sets the label in monospace, for a repo or package name. */
export function BackLink({ href, code = false, children }: { href: string; code?: boolean | undefined; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex max-w-full items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground", code && "font-mono")}
    >
      <ChevronLeft aria-hidden className="size-3 shrink-0" />
      {children}
    </Link>
  );
}
