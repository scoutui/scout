import Link from "next/link";
import type { MigrationStatus } from "@scoutui/web-shared";
import { PackageName } from "@/components/package-name";
import { cn } from "@/lib/utils";

/**
 * The lifecycle line on a detail page: the replacement, linking to `replacementHref` when it's given, or why the
 * component was retired.
 */
export function MigrationLine({ status, replacementHref }: { status: MigrationStatus; replacementHref?: string | undefined }) {
  if (status.status === "active") return null;
  if (status.status === "retired") return <p className="text-sm text-muted-foreground">Retired: {status.reason}</p>;

  const { packageName, exportName } = status.by;
  const full = exportName ? `${packageName}/${exportName}` : packageName;
  const className = "flex min-w-0 font-mono text-foreground";
  const width = { flex: `0 1 calc(${full.length}ch + 1px)` };
  const name = (
    <>
      <span className="grid min-w-0" style={{ flex: `0 1 calc(${packageName.length}ch + 1px)` }}>
        <PackageName name={packageName} />
      </span>
      {exportName ? <span className="shrink-0">/{exportName}</span> : null}
    </>
  );

  return (
    <p className="flex items-baseline gap-x-1.5 text-sm text-muted-foreground">
      <span className="shrink-0">Replaced by</span>
      {replacementHref ? (
        <Link href={replacementHref} aria-label={full} title={full} className={cn(className, "underline-offset-3 hover:underline")} style={width}>
          {name}
        </Link>
      ) : (
        <span title={full} className={className} style={width}>{name}</span>
      )}
    </p>
  );
}
