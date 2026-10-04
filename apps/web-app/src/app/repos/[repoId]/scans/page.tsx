import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, CircleX } from "lucide-react";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { getPool } from "@/db/client";
import { getStorage } from "@/lib/storage";
import { readModelPage } from "@/lib/read-model-page";
import { getReadModelProgress, skippedState } from "@/lib/read-model-progress";
import { fallbackStates, ReadModelState, SkippedScansNotice } from "@/components/read-model-state";
import { ScanRowActions } from "@/components/repos/scan-row-actions";
import { can } from "@/lib/access";
import { identify } from "@/lib/identity";
import { relativeTime } from "@/lib/relative-time";
import { shortScanId } from "@/lib/scan-id";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const decoded = decodeURIComponent(repoId);
  const page = await readModelPage(getStorage(), snapshot => snapshot.getRepo(decoded));
  if (page.state !== "ready") return { title: `Scan history · ${decoded}` };
  const detail = page.value;
  if (!detail) notFound();
  return { title: `Scan history · ${decoded}` };
}

export default async function RepoScansPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId: rawRepoId } = await params;
  // repoIds can contain "/" (monorepo per-app ids); decode the %2F-encoded param.
  const repoId = decodeURIComponent(rawRepoId);
  const page = await readModelPage(getStorage(), async snapshot => ({
    detail: await snapshot.getRepo(repoId), scans: await snapshot.listScans(repoId),
  }));
  if (page.state !== "ready") return (
    <ReadModelState {...page} heading={{ title: "Scan history", back: { href: `/repos/${encodeURIComponent(repoId)}`, label: repoId, code: true } }} />
  );
  const { detail, scans } = page.value;
  if (!detail) notFound();
  const unready = await getReadModelProgress(getPool(), scans.filter(scan => !scan.ready).map(scan => scan.scanId));
  const states = new Map(unready.map(scan => [scan.scanId, skippedState(scan)]));
  const canManage = can(await identify({ browser: true }), "manage-repos", { repoId });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href={`/repos/${encodeURIComponent(repoId)}`}
          className="inline-flex items-center gap-1 rounded-sm font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-3" />
          {repoId}
        </Link>
        <h1 className="text-2xl font-semibold tracking-headline">
          Scan history
          <span className="ml-2 text-sm tabular-nums text-muted-foreground">
            {scans.length.toLocaleString()}
          </span>
        </h1>
      </div>
      <SkippedScansNotice fallbacks={page.fallbacks} ownPage />

      {scans.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scans found for this repo.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Committed</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Commit</TableHead>
                <TableHead>Scanned</TableHead>
                <TableHead className="hidden sm:table-cell">Scanned by</TableHead>
                <TableHead className="hidden w-full sm:table-cell">Scan ID</TableHead>
                <TableHead className="text-right">{/* view link */}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scans.map((s, i) => {
                const isLatest = i === 0;
                const state = states.get(s.scanId);
                const viewHref = isLatest
                  ? `/repos/${encodeURIComponent(repoId)}`
                  : `/repos/${encodeURIComponent(repoId)}?scan=${encodeURIComponent(s.scanId)}`;
                const viewLink = (
                  <Link href={viewHref} className="text-xs text-foreground underline-offset-4 hover:underline">
                    View scan
                  </Link>
                );
                return (
                  <TableRow key={s.scanId}>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-baseline sm:gap-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-foreground" title={formatAbsoluteUtc(s.committedAt)}>
                            {relativeTime(s.committedAt)}
                          </span>
                          {isLatest ? (
                            <span className="rounded-sm border border-border px-1.5 py-0.5 text-label text-muted-foreground">
                              latest
                            </span>
                          ) : null}
                        </div>
                        {state === "failed" || state === "degraded" ? (
                          <span className="inline-flex items-baseline gap-1 rounded-sm border border-border px-1.5 py-0.5 text-label text-status-err">
                            <CircleX aria-hidden className="size-3 shrink-0 self-center" />
                            {fallbackStates[state]}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.branch ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.commit.slice(0, 7)}</TableCell>
                    <TableCell>
                      <span title={formatAbsoluteUtc(s.arrivedAt)}>{relativeTime(s.arrivedAt)}</span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {s.uploadedBy ? (
                        <span title={s.uploadedBy.email} className="block max-w-48 truncate">
                          {s.uploadedBy.name ?? s.uploadedBy.email}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell" title={s.scanId}>
                      {shortScanId(s.scanId)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <ScanRowActions repoId={repoId} scanId={s.scanId} scanCount={scans.length}>{viewLink}</ScanRowActions>
                      ) : viewLink}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
