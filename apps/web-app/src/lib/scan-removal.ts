import type { Pool, PoolClient } from "pg";
import { ulid } from "ulid";
import { enqueueChartResults, newestScanFirstSql } from "@scoutui/web-shared";
import type { Person } from "./access.ts";
import { errorClass } from "./scan-jobs.ts";
import { reconcileScanJobs } from "./scan-reconciliation.ts";

/** Deletes the scans `scanIds` with their uploads and archives, apart from the upload `keepUploadId`. */
export async function deleteScans(client: PoolClient, scanIds: string[], keepUploadId?: string): Promise<void> {
  const { rows } = await client.query<{ upload_id: string }>(`WITH deleted AS (
      DELETE FROM scans WHERE scan_id = ANY($1::text[]) RETURNING scan_id, source_upload_id
    )
    SELECT source_upload_id AS upload_id FROM deleted WHERE source_upload_id IS NOT NULL
    UNION SELECT upload_id FROM scan_uploads WHERE scan_id IN (SELECT scan_id FROM deleted)`, [scanIds]);
  const uploadIds = rows.map(row => row.upload_id).filter(uploadId => uploadId !== keepUploadId);
  if (uploadIds.length) await client.query("DELETE FROM scan_uploads WHERE upload_id = ANY($1::text[])", [uploadIds]);
}

export type RemovalResult = { ok: true } | { ok: false; error: string };

const HISTORY_CHANGED: RemovalResult = { ok: false, error: "The scan history has changed since the page loaded. Reload to see it." };

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Removes the scan `scanId` of the repo `repoId`, with its upload and archive, and records the removal. Refuses the
 * repo's only scan. When the removed scan was the latest, the worker rebuilds the new latest scan's details.
 */
export async function removeStoredScan(pool: Pool, actor: Person, repoId: string, scanId: string): Promise<RemovalResult> {
  const latest = await inTransaction(pool, async (client) => {
    await client.query("SELECT 1 FROM repos WHERE repo_id = $1 FOR UPDATE", [repoId]);
    const { rows: scans } = await client.query<{ scan_id: string; commit_sha: string }>(
      `SELECT scan_id, commit_sha FROM scans WHERE repo_id = $1 ORDER BY ${newestScanFirstSql()}`, [repoId]);
    const removed = scans.find(scan => scan.scan_id === scanId);
    if (!removed || scans.length === 1) return null;
    await deleteScans(client, [scanId]);
    await client.query("INSERT INTO removals (id, actor_email, repo_id, commit_sha) VALUES ($1, $2, $3, $4)",
      [ulid(), actor.email, repoId, removed.commit_sha]);
    await enqueueChartResults(client);
    return scans.find(scan => scan.scan_id !== scanId)?.scan_id ?? null;
  });
  if (latest === null) return HISTORY_CHANGED;
  await reconcileScanJobs(pool, 1, [latest]).catch((error: unknown) => {
    console.error(`[repos] couldn't queue scan ${latest} to rebuild its details after a removal; the worker's next check queues it (${errorClass(error)})`);
  });
  return { ok: true };
}

/** Deletes the repo `repoId` with all its scans, their uploads and archives, and records the deletion. Does nothing when it has gone. */
export async function deleteStoredRepo(pool: Pool, actor: Person, repoId: string): Promise<void> {
  await inTransaction(pool, async (client) => {
    const { rowCount } = await client.query("SELECT 1 FROM repos WHERE repo_id = $1 FOR UPDATE", [repoId]);
    if (!rowCount) return;
    const { rows: scans } = await client.query<{ scan_id: string }>("SELECT scan_id FROM scans WHERE repo_id = $1", [repoId]);
    await deleteScans(client, scans.map(scan => scan.scan_id));
    await client.query("DELETE FROM repos WHERE repo_id = $1", [repoId]);
    await client.query("INSERT INTO removals (id, actor_email, repo_id, scan_count) VALUES ($1, $2, $3, $4)",
      [ulid(), actor.email, repoId, scans.length]);
    await enqueueChartResults(client);
  });
}

/** A scan an Admin removed (`commitSha` set) or a repo an Admin deleted (`scanCount` set). */
export type Removal = { id: string; removedAt: string; actorEmail: string; repoId: string; commitSha: string | null; scanCount: number | null };

/** The latest `limit` removals, newest first. */
export async function listRemovals(pool: Pool, limit: number): Promise<Removal[]> {
  const { rows } = await pool.query<Omit<Removal, "removedAt"> & { removedAt: Date }>(`SELECT id, removed_at AS "removedAt",
      actor_email AS "actorEmail", repo_id AS "repoId", commit_sha AS "commitSha", scan_count AS "scanCount"
    FROM removals ORDER BY removed_at DESC, id DESC LIMIT $1`, [limit]);
  return rows.map(row => ({ ...row, removedAt: row.removedAt.toISOString() }));
}
