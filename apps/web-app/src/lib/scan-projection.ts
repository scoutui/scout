import type { Pool, PoolClient } from "pg";
import type { ScanArtifact } from "@scoutui/scan-format";
import {
  createProjectionContext, deriveReadModelRows, enqueueChartResults, newestScanFirstSql,
  PROJECTION_VERSION, READ_MODEL_FORMAT_VERSION, type ProjectionContext, type ReadModelRow,
} from "@scoutui/web-shared";
import { deleteReadModelRows, writeReadModelRows } from "./read-model-write.ts";
import { commitDecision, storedScans } from "./scan-acceptance.ts";
import { repoIdentityRefusal } from "./repo-identity.ts";
import { deleteScans } from "./scan-removal.ts";
import { readStoredArtifact } from "./stored-artifact.ts";
import { completeScanJob } from "./scan-jobs.ts";
import { ScanValidationError } from "./scan-validation.ts";

export type PublicationGuard = { jobId: string; leaseToken: string };
/**
 * `rescan` lets an upload replace its commit's stored scan. Without it, an upload of a stored commit is a duplicate of that scan,
 * unless the stored scan can't be read and no rebuild of it is queued or running: then the upload replaces it.
 */
export type PublishOptions = { uploadedByUserId: string | null; signal?: AbortSignal; force?: boolean; rescan?: boolean }
  & ({ sourceUploadId?: undefined; guard?: PublicationGuard } | { sourceUploadId: string; guard: PublicationGuard });
export type PublishResult = { status: "inserted" | "rebuilt" | "exists"; scanId: string; revision: number };
/** An incoming scan whose full artifact the publisher clears once an existing canonical scan makes it unnecessary. */
export type ScanSource = { readonly meta: ScanArtifact["meta"]; artifact: ScanArtifact | undefined };

type ScanRow = {
  repo_id: string;
  commit_sha: string;
  scanner_version: string;
  source_upload_id: string | null;
};
type Header = {
  projection_version: number;
  format_version: number;
  state: string;
  build_revision: number;
  expected_counts: Record<string, number>;
  actual_counts: Record<string, number>;
  details_retained: boolean;
};

function verifyIdentity(stored: ScanRow, meta: ScanArtifact["meta"]): void {
  if (stored.repo_id !== meta.repo.id || stored.commit_sha !== meta.repo.commit || stored.scanner_version !== meta.scannerVersion) {
    throw new ScanValidationError("identity_conflict");
  }
}

/** Deletes the repo's other scans of this scan's commit, with their uploads and archives, keeping the incoming upload. */
async function deleteReplacedScans(client: PoolClient, meta: ScanArtifact["meta"], sourceUploadId: string | undefined): Promise<void> {
  const { rows } = await client.query<{ scan_id: string }>("SELECT scan_id FROM scans WHERE repo_id = $1 AND commit_sha = $2 AND scan_id <> $3",
    [meta.repo.id, meta.repo.commit, meta.scanId]);
  await deleteScans(client, rows.map(row => row.scan_id), sourceUploadId);
}

const countTables = {
  repo: "scan_repo_views", component: "scan_component_facts", package: "scan_package_contributions",
  detail: "scan_component_details", occurrence: "scan_occurrence_views",
};

async function persistedCounts(client: PoolClient, scanId: string): Promise<Record<string, number>> {
  const queries = Object.entries(countTables).map(([kind, table]) => `SELECT '${kind}' AS kind, count(*)::int AS n FROM ${table} WHERE scan_id = $1`);
  for (const kind of ["graph-node", "graph-edge"]) {
    queries.push(`SELECT '${kind}' AS kind, count(*)::int AS n FROM scan_composition_graphs WHERE scan_id = $1 AND kind = '${kind}'`);
  }
  const { rows } = await client.query<{ kind: string; n: number }>(queries.join(" UNION ALL "), [scanId]);
  return Object.fromEntries(rows.map(row => [row.kind, row.n]));
}

function equalCounts(a: Record<string, number>, b: Record<string, number>): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, value]) => value === b[key]);
}

async function pruneDetails(client: PoolClient, repoId: string, scanId: string): Promise<void> {
  for (const table of ["scan_component_details", "scan_occurrence_views"]) {
    await client.query(`DELETE FROM ${table} AS child USING scans WHERE child.scan_id = scans.scan_id AND scans.repo_id = $1 AND scans.scan_id <> $2`, [repoId, scanId]);
  }
  await client.query(`UPDATE scan_read_models AS model SET details_retained = false,
    expected_counts = expected_counts || '{"detail":0,"occurrence":0}'::jsonb,
    actual_counts = actual_counts || '{"detail":0,"occurrence":0}'::jsonb
    FROM scans WHERE model.scan_id = scans.scan_id AND scans.repo_id = $1 AND scans.scan_id <> $2 AND model.details_retained`, [repoId, scanId]);
}

function* retainedRows(input: ScanArtifact, context: ProjectionContext, detailsRetained: boolean, signal?: AbortSignal): Iterable<ReadModelRow> {
  for (const row of deriveReadModelRows(input, context)) {
    signal?.throwIfAborted();
    if (detailsRetained || (row.kind !== "detail" && row.kind !== "occurrence")) yield row;
  }
}

async function readCanonicalArtifact(pool: Pool, scanId: string): Promise<ScanArtifact | undefined> {
  const client = await pool.connect();
  try {
    const stored = await readStoredArtifact(client, scanId);
    if (stored && "degraded" in stored) throw new ScanValidationError(stored.reason, `degraded: ${stored.reason}`);
    return stored?.artifact;
  } finally {
    client.release();
  }
}

export function publishScan(pool: Pool, artifact: ScanArtifact, options: PublishOptions): Promise<PublishResult> {
  return publish(pool, { meta: artifact.meta, artifact }, options, undefined);
}

export function publishScanSource(pool: Pool, source: ScanSource, options: PublishOptions): Promise<PublishResult> {
  return publish(pool, source, options, undefined);
}

/** Republishes a stored scan from its canonical source; null when the scan does not exist. `force` rebuilds an unchanged ready model. */
export async function republishScan(
  pool: Pool, scanId: string, options: { guard?: PublicationGuard; signal?: AbortSignal; force?: boolean },
): Promise<PublishResult | null> {
  const canonical = await readCanonicalArtifact(pool, scanId);
  return canonical ? publish(pool, { meta: canonical.meta, artifact: canonical }, { uploadedByUserId: null, ...options }, canonical) : null;
}

function publish(pool: Pool, source: ScanSource, options: PublishOptions, preloaded: undefined): Promise<PublishResult>;
function publish(pool: Pool, source: ScanSource, options: PublishOptions, preloaded: ScanArtifact): Promise<PublishResult | null>;
async function publish(pool: Pool, source: ScanSource, options: PublishOptions, preloaded: ScanArtifact | undefined): Promise<PublishResult | null> {
  const scanId = source.meta.scanId;
  let canonicalSource = preloaded;
  let loadCanonical = false;
  for (;;) {
    const { rows: [canonical] } = await pool.query<ScanRow>("SELECT repo_id, commit_sha, scanner_version, source_upload_id FROM scans WHERE scan_id = $1", [scanId]);
    if (!canonical && preloaded) return null;
    if (canonical) {
      verifyIdentity(canonical, source.meta);
      source.artifact = undefined;
      if (loadCanonical && !canonicalSource) canonicalSource = await readCanonicalArtifact(pool, scanId);
    }
    const outcome = await attemptPublication(pool, source, canonical, canonicalSource, options);
    if (outcome === "load-canonical") loadCanonical = true;
    else if (outcome !== "retry") return outcome;
  }
}

async function attemptPublication(
  pool: Pool, source: ScanSource, canonical: ScanRow | undefined, canonicalSource: ScanArtifact | undefined, options: PublishOptions,
): Promise<PublishResult | "retry" | "load-canonical"> {
  const { meta } = source;
  const scanId = meta.scanId;
  const incoming = canonical ? canonicalSource : source.artifact;
  if (!canonical && !incoming) throw new Error("Scan was removed during publication");
  const input = incoming && (incoming.diagnostics ? incoming : { ...incoming, diagnostics: [] });
  const context = input && createProjectionContext(input);
  options.signal?.throwIfAborted();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO repos (repo_id, git_remote) VALUES ($1, $2)
      ON CONFLICT (repo_id) DO UPDATE SET updated_at = now(), git_remote = COALESCE(repos.git_remote, EXCLUDED.git_remote)`, [meta.repo.id, canonical ? null : (input?.meta ?? meta).repo.gitRemote]);
    const { rows: [locked] } = await client.query<ScanRow>("SELECT repo_id, commit_sha, scanner_version, source_upload_id FROM scans WHERE scan_id = $1 FOR UPDATE", [scanId]);
    if (locked) verifyIdentity(locked, meta);
    if (Boolean(locked) !== Boolean(canonical)) {
      await client.query("ROLLBACK");
      return "retry";
    }
    let replaced = false;
    if (locked && input) {
      await client.query("UPDATE scans SET committed_at = $2, branch_position = $3, branch = COALESCE(branch, $4) WHERE scan_id = $1",
        [scanId, input.meta.repo.committedAt, input.meta.repo.branchPosition ?? null, input.meta.repo.branch]);
    } else if (!locked) {
      const identityRefusal = await repoIdentityRefusal(client, { repoId: meta.repo.id, remote: meta.repo.gitRemote });
      if (identityRefusal) throw new ScanValidationError(identityRefusal.code, identityRefusal.message);
      const stored = (await storedScans(client, meta.repo.id, [meta.repo.commit])).get(meta.repo.commit);
      const decision = commitDecision(stored, { commit: meta.repo.commit, scanner: meta.scannerName ?? null, scannerVersion: meta.scannerVersion },
        { rescan: Boolean(options.rescan) });
      if (decision.kind === "duplicate") {
        if (options.guard) {
          await completeScanJob(client, options.guard, options.sourceUploadId ? { uploadId: options.sourceUploadId, scanId: decision.scanId, state: "duplicate" } : null);
        }
        await client.query("COMMIT");
        return { status: "exists", scanId: decision.scanId, revision: decision.revision };
      }
      if (decision.kind === "refuse") throw new ScanValidationError(decision.refusal.code, decision.refusal.message);
      if (decision.kind === "replace") await deleteReplacedScans(client, meta, options.sourceUploadId);
      replaced = decision.kind === "replace";
      const inserted = await client.query(`INSERT INTO scans (scan_id, repo_id, committed_at, commit_sha, branch, branch_position, scanner, scanner_version, artifact, source_upload_id, uploaded_by_user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (scan_id) DO NOTHING`,
      [scanId, meta.repo.id, meta.repo.committedAt, meta.repo.commit, meta.repo.branch, meta.repo.branchPosition ?? null, meta.scannerName ?? null, meta.scannerVersion,
        options.sourceUploadId ? null : JSON.stringify(incoming), options.sourceUploadId ?? null, options.uploadedByUserId]);
      if (!inserted.rowCount) {
        await client.query("ROLLBACK");
        return "retry";
      }
    }
    const receipt = options.sourceUploadId
      ? { uploadId: options.sourceUploadId, scanId, state: !locked || locked.source_upload_id === options.sourceUploadId ? "ready" as const : "duplicate" as const, replaced }
      : null;
    const { rows: [header] } = await client.query<Header>("SELECT * FROM scan_read_models WHERE scan_id = $1", [scanId]);
    if (header && (header.projection_version > PROJECTION_VERSION || header.format_version > READ_MODEL_FORMAT_VERSION)) {
      throw new Error("Cannot replace a newer read model version");
    }
    const { rows: [latest] } = await client.query<{ scan_id: string }>(`SELECT scans.scan_id FROM scans
      LEFT JOIN scan_read_models AS model USING (scan_id)
      WHERE scans.repo_id = $1 AND (model.state = 'ready' OR scans.scan_id = $2)
      ORDER BY ${newestScanFirstSql("scans")} LIMIT 1`, [meta.repo.id, scanId]);
    const detailsRetained = latest?.scan_id === scanId;
    if (!options.force && header?.state === "ready" && header.projection_version === PROJECTION_VERSION
      && header.format_version === READ_MODEL_FORMAT_VERSION && header.details_retained === detailsRetained
      && equalCounts(header.expected_counts, header.actual_counts)
      && equalCounts(header.actual_counts, await persistedCounts(client, scanId))) {
      if (options.guard) await completeScanJob(client, options.guard, receipt);
      await client.query("COMMIT");
      return { status: "exists", scanId, revision: header.build_revision };
    }
    if (!input || !context) {
      await client.query("ROLLBACK");
      return "load-canonical";
    }
    if (detailsRetained) await pruneDetails(client, meta.repo.id, scanId);
    await deleteReadModelRows(client, scanId);
    const counts = await writeReadModelRows(client, scanId, retainedRows(input, context, detailsRetained, options.signal));
    const revision = (header?.build_revision ?? 0) + 1;
    await client.query(`INSERT INTO scan_read_models (scan_id, projection_version, format_version, state, build_revision, expected_counts, actual_counts, details_retained)
      VALUES ($1, $2, $3, 'ready', $4, $5, $5, $6)
      ON CONFLICT (scan_id) DO UPDATE SET projection_version = EXCLUDED.projection_version,
        format_version = EXCLUDED.format_version, state = EXCLUDED.state, build_revision = EXCLUDED.build_revision,
        expected_counts = EXCLUDED.expected_counts, actual_counts = EXCLUDED.actual_counts,
        details_retained = EXCLUDED.details_retained, built_at = now()`,
    [scanId, PROJECTION_VERSION, READ_MODEL_FORMAT_VERSION, revision, JSON.stringify(counts), detailsRetained]);
    if (options.guard) {
      options.signal?.throwIfAborted();
      await completeScanJob(client, options.guard, receipt);
    }
    await enqueueChartResults(client);
    await client.query("COMMIT");
    return { status: canonical ? "rebuilt" : "inserted", scanId, revision };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
