import type { Pool, PoolClient } from "pg";
import { compareCliVersions, isSnapshotVersion, SCHEMA_VERSION } from "@scoutui/scan-format";
import { PROJECTION_VERSION, scanModelReady, type ScanModelHeader } from "@scoutui/web-shared";
import { scanValidationMessage, type ScanValidationCode } from "./scan-validation.ts";

/** Why the dashboard won't accept a scan, with the message the upload reports. */
export type Refusal = { code: ScanValidationCode; message: string };

type Scanner = { scanner: string | null; scannerVersion: string };

/**
 * Why a `--rescan` upload may not replace its commit's stored scan, or null when it may.
 * Versions are compared only between scans from the same scanner: a release older than the one that made the stored scan
 * is refused, a snapshot build (`0.0.0-…`) never is, and a scan from another scanner may always be replaced.
 */
export function rescanRefusal(stored: Scanner & { commit: string }, incoming: Scanner): string | null {
  if (stored.scanner !== incoming.scanner) return null;
  if (isSnapshotVersion(incoming.scannerVersion) || compareCliVersions(incoming.scannerVersion, stored.scannerVersion) >= 0) return null;
  const commit = stored.commit.slice(0, 7);
  const version = stored.scannerVersion;
  return `Couldn't upload the scan: ${commit} was scanned with a newer CLI (${version}). Upgrade the CLI to ${version} or newer, or run npx @scoutui/cli@${version} scan --rescan.`;
}

/** The scan formats (`schemaVersion`s) the dashboard reads. */
export const SCAN_FORMATS: readonly number[] = [SCHEMA_VERSION];

/** A CLI whose scans the dashboard reads, and the command to suggest running it with. */
type MatchingCli = { version: string; command: "scan" | "auth login" };

/**
 * Why the dashboard can't read a scan file of this schema version, or null when it can. With `matchingCli`, the line names
 * that CLI's version and an `npx` command that runs it, and starts "Couldn't sign in:" when the command is `auth login`.
 */
export function versionRefusal(schemaVersion: number | "invalid", options: { matchingCli?: MatchingCli } = {}): Refusal | null {
  if (schemaVersion !== "invalid" && SCAN_FORMATS.includes(schemaVersion)) return null;
  const newer = typeof schemaVersion === "number" && schemaVersion > SCHEMA_VERSION;
  const cli = options.matchingCli;
  if (!cli) {
    return {
      code: "unsupported_version",
      message: newer
        ? "Couldn't upload the scan: this CLI is newer than the dashboard. Ask your dashboard administrator to upgrade it."
        : "Couldn't upload the scan: this CLI is too old for the dashboard. Upgrade the CLI and try again.",
    };
  }
  const start = cli.command === "auth login" ? "Couldn't sign in:" : "Couldn't upload the scan:";
  const run = `run npx @scoutui/cli@${cli.version} ${cli.command}`;
  return {
    code: "unsupported_version",
    message: newer
      ? `${start} this CLI is newer than the dashboard. Ask your dashboard administrator to upgrade it, or ${run}.`
      : `${start} this CLI is too old for the dashboard. Upgrade the CLI to ${cli.version}, or ${run}.`,
  };
}

/** Why the dashboard won't accept a scan with this schema version and scanner, or null when it will. */
export function acceptScan(
  scan: { schemaVersion: number | "invalid"; scannerName: string | null | undefined }, options: { matchingCli?: MatchingCli } = {},
): Refusal | null {
  const refusal = versionRefusal(scan.schemaVersion, options);
  if (refusal) return refusal;
  if (!scan.scannerName) return { code: "unsupported_scanner", message: scanValidationMessage("unsupported_scanner") };
  return null;
}

/** A stored scan of a commit with its read model's header, and whether a rebuild of it is queued or running. */
export type StoredScan = ScanModelHeader & { scan_id: string; commit_sha: string; scanner: string | null; scanner_version: string; rebuilding: boolean };

/** The repo's stored scans of these commits, keyed by commit. */
export async function storedScans(db: Pool | PoolClient, repoId: string, commits: readonly string[]): Promise<Map<string, StoredScan>> {
  const { rows } = await db.query<StoredScan>(`SELECT scans.scan_id, scans.commit_sha, scans.scanner, scans.scanner_version,
      model.state, model.projection_version, model.format_version, model.build_revision, model.expected_counts, model.actual_counts, model.details_retained,
      EXISTS (SELECT 1 FROM scan_jobs AS job WHERE job.kind = 'scan' AND job.scan_id = scans.scan_id AND job.projection_version = $3
        AND job.state IN ('queued', 'processing')) AS rebuilding
    FROM scans LEFT JOIN scan_read_models AS model USING (scan_id) WHERE scans.repo_id = $1 AND scans.commit_sha = ANY($2::text[])`,
  [repoId, commits, PROJECTION_VERSION]);
  return new Map(rows.map(row => [row.commit_sha, row]));
}

export type CommitDecision =
  | { kind: "insert" }
  | { kind: "duplicate"; scanId: string; revision: number }
  | { kind: "replace" }
  | { kind: "refuse"; refusal: Refusal };

/**
 * What an upload does with its commit's stored scan. With none it inserts. Without `rescan`, it is a duplicate of a stored scan
 * that can be read or whose rebuild is queued or running. Otherwise it replaces the stored scan, unless `rescanRefusal` refuses.
 */
export function commitDecision(
  stored: StoredScan | undefined, incoming: { commit: string; scanner: string | null; scannerVersion: string }, options: { rescan: boolean },
): CommitDecision {
  if (!stored) return { kind: "insert" };
  if (!options.rescan && (scanModelReady(stored) || stored.rebuilding)) {
    return { kind: "duplicate", scanId: stored.scan_id, revision: stored.build_revision ?? 0 };
  }
  const refusal = rescanRefusal(
    { commit: incoming.commit, scanner: stored.scanner, scannerVersion: stored.scanner_version },
    { scanner: incoming.scanner, scannerVersion: incoming.scannerVersion },
  );
  return refusal ? { kind: "refuse", refusal: { code: "scanned_with_newer_cli", message: refusal } } : { kind: "replace" };
}
