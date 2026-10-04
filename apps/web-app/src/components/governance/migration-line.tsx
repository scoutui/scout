import Link from "next/link";
import type { MigrationStatus } from "@scoutui/web-shared";

/**
 * The lifecycle line on a detail page. When the governing record is known, the
 * whole line links to it on /governance.
 */
export function MigrationLine({
  status,
  recordId,
}: {
  status: MigrationStatus;
  recordId?: string | null;
}) {
  if (status.status === "active") return null;

  const body =
    status.status === "superseded" ? (
      <>
        Replaced by →{" "}
        <span className="font-mono text-foreground/90">
          {status.by.exportName ? `${status.by.packageName}/${status.by.exportName}` : status.by.packageName}
        </span>
      </>
    ) : (
      <>Retired · {status.reason}</>
    );

  if (!recordId) return <p className="text-xs text-muted-foreground">{body}</p>;

  return (
    <p className="text-xs text-muted-foreground">
      <Link
        href={`/governance#record-${recordId}`}
        className="rounded-sm underline-offset-4 hover:text-foreground hover:underline"
      >
        {body}
      </Link>
    </p>
  );
}
