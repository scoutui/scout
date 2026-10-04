import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/db/client";
import { can, UPLOAD_REFUSAL } from "@/lib/access";
import { builtWithCli } from "@/lib/built-with-cli";
import { dashboardWarning } from "@/lib/dashboard-warning";
import { identify } from "@/lib/identity";
import { rateLimit, clientKey, logRateLimitRejection } from "@/lib/rate-limit";
import { repoIdentityRefusal } from "@/lib/repo-identity";
import { readJsonBody } from "@/lib/request-body";
import { acceptScan, commitDecision, SCAN_FORMATS, storedScans } from "@/lib/scan-acceptance";
import { errorClass, repoScanUrl } from "@/lib/scan-jobs";

const PREFLIGHT_LIMIT = 30;
const PREFLIGHT_WINDOW_MS = 600_000;
const BODY_LIMIT_BYTES = 64 * 1024;

const PreflightRequest = z.object({
  repoId: z.string().min(1),
  remote: z.string().nullable(),
  scanner: z.string().min(1),
  scannerVersion: z.string().min(1),
  schemaVersion: z.number().int(),
  rescan: z.boolean(),
  commits: z.array(z.string().min(1)).min(1).max(500),
});

/**
 * Answers whether the dashboard would take an upload of this scan, before the CLI scans. `refusal` is set when it would refuse
 * the whole scan, and `commits` is then empty. Otherwise `commits` says, in request order, whether an upload of each commit
 * would be stored, skipped as a scan the dashboard already has, or refused. `warning` is a line for the CLI to print, or null.
 * `scanFormats` lists the scan formats the dashboard reads.
 * It only reads, so the upload stays the final word.
 */
export async function POST(req: Request): Promise<Response> {
  let identity: Awaited<ReturnType<typeof identify>>;
  try {
    identity = await identify({ bearer: req.headers.get("authorization") });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!identity) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(identity, "upload")) {
    return NextResponse.json({ refusal: UPLOAD_REFUSAL, commits: [], warning: dashboardWarning(), scanFormats: SCAN_FORMATS });
  }

  const key = identity.kind === "ci" ? `preflight:ci:${clientKey(req)}` : `preflight:user:${identity.userId}`;
  const limited = rateLimit(key, PREFLIGHT_LIMIT, PREFLIGHT_WINDOW_MS);
  if (!limited.ok) {
    logRateLimitRejection("preflight", key);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const read = await readJsonBody(req, BODY_LIMIT_BYTES);
  if ("tooLarge" in read) return read.tooLarge;
  const parsed = PreflightRequest.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  const scan = parsed.data;

  try {
    const pool = getPool();
    const refusal = acceptScan({ schemaVersion: scan.schemaVersion, scannerName: scan.scanner }, { matchingCli: { version: builtWithCli, command: "scan" } })
      ?? await repoIdentityRefusal(pool, { repoId: scan.repoId, remote: scan.remote });
    if (refusal) return NextResponse.json({ refusal, commits: [], warning: dashboardWarning(), scanFormats: SCAN_FORMATS });
    const stored = await storedScans(pool, scan.repoId, scan.commits);
    const commits = scan.commits.map(commit => {
      const decision = commitDecision(stored.get(commit), { commit, scanner: scan.scanner, scannerVersion: scan.scannerVersion }, { rescan: scan.rescan });
      if (decision.kind === "duplicate") return { commit, decision: "skip", url: repoScanUrl(scan.repoId) };
      if (decision.kind === "refuse") return { commit, decision: "refuse", code: decision.refusal.code, message: decision.refusal.message };
      return { commit, decision: "upload" };
    });
    return NextResponse.json({ refusal: null, commits, warning: dashboardWarning(), scanFormats: SCAN_FORMATS });
  } catch (error) {
    console.error(`[preflight] check failed: ${errorClass(error)}`);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
