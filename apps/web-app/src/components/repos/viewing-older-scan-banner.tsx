import Link from "next/link";
import { History } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

export function ViewingOlderScanBanner({
  repoId,
  arrivedAt,
}: {
  repoId: string;
  arrivedAt: string;
}) {
  return (
    <aside
      aria-label="Older scan notice"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-accent/40 px-3 py-2 text-xs text-foreground"
    >
      <span className="flex min-w-0 grow basis-60 items-start gap-x-2">
        <History aria-hidden className="mt-px size-3.5 shrink-0 text-muted-foreground" />
        <span>
          Viewing the scan from{" "}
          <span title={formatAbsoluteUtc(arrivedAt)} className="font-medium">
            {relativeTime(arrivedAt)}
          </span>
          . Counts are from that scan.
        </span>
      </span>
      <Link
        href={`/repos/${encodeURIComponent(repoId)}`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto")}
      >
        Back to latest
      </Link>
    </aside>
  );
}
