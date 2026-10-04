import Link from "next/link";
import { History } from "lucide-react";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { relativeTime } from "@/lib/relative-time";

export function ViewingOlderScanBanner({
  repoId,
  committedAt,
  arrivedAt,
}: {
  repoId: string;
  committedAt: string;
  arrivedAt: string;
}) {
  return (
    <aside
      aria-label="Older scan notice"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-accent/40 px-3 py-2 text-xs text-foreground"
    >
      <span className="flex min-w-0 grow basis-72 items-start gap-x-3">
        <History aria-hidden className="mt-px size-3.5 shrink-0 text-muted-foreground" />
        <span>
          Viewing an older scan: committed{" "}
          <span title={formatAbsoluteUtc(committedAt)} className="font-medium">
            {relativeTime(committedAt)}
          </span>
          , scanned{" "}
          <span title={formatAbsoluteUtc(arrivedAt)} className="font-medium">
            {relativeTime(arrivedAt)}
          </span>
          .
        </span>
      </span>
      <Link
        href={`/repos/${encodeURIComponent(repoId)}`}
        className="ml-auto text-foreground underline-offset-4 hover:underline"
      >
        View latest scan
      </Link>
    </aside>
  );
}
