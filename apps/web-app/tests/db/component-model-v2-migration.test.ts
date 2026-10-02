import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withReadModelDatabase } from "../helpers/read-model-db";
import { receiveArtifact, sampleArtifact } from "../helpers/scan-artifact";

const { DATABASE_URL: databaseUrl } = process.env;
describe.skipIf(!databaseUrl)("one scan per commit", { timeout: 30_000 }, () => {
  it("the migration keeps each commit's most recently created scan and deletes the others with their uploads and archives", async () => {
    await withReadModelDatabase(async pool => {
      await pool.query("DROP INDEX scans_repo_commit; ALTER TABLE scans DROP COLUMN branch_position");
      await pool.query("INSERT INTO repos (repo_id) VALUES ('repo-a'), ('repo-b')");
      const uploads = new Map<string, string>();
      for (const [scanId, repoId, commit, createdAt] of [
        ["replaced", "repo-a", "abc", "2026-09-20T00:00:00Z"],
        ["kept", "repo-a", "abc", "2026-09-21T00:00:00Z"],
        ["other-commit", "repo-a", "def", "2026-09-19T00:00:00Z"],
        ["other-repo", "repo-b", "abc", "2026-09-19T00:00:00Z"],
      ] as const) {
        const uploadId = await receiveArtifact(pool, sampleArtifact({ scanId, repoId }));
        await pool.query(`INSERT INTO scans (scan_id, repo_id, committed_at, commit_sha, scanner_version, source_upload_id, created_at)
          VALUES ($1, $2, now(), $3, '0', $4, $5)`, [scanId, repoId, commit, uploadId, createdAt]);
        await pool.query("UPDATE scan_uploads SET scan_id = $1, state = 'ready' WHERE upload_id = $2", [scanId, uploadId]);
        uploads.set(scanId, uploadId);
      }
      const repeat = await receiveArtifact(pool, sampleArtifact({ scanId: "replaced" }));
      await pool.query("UPDATE scan_uploads SET scan_id = 'replaced', state = 'duplicate' WHERE upload_id = $1", [repeat]);

      await pool.query(readFileSync(new URL("../../drizzle/migrations/0001_one_scan_per_commit.sql", import.meta.url), "utf8"));

      expect((await pool.query("SELECT scan_id FROM scans ORDER BY scan_id")).rows.map(row => row.scan_id)).toEqual(["kept", "other-commit", "other-repo"]);
      const left = ["kept", "other-commit", "other-repo"].map(scanId => uploads.get(scanId)).sort();
      expect((await pool.query("SELECT upload_id FROM scan_uploads ORDER BY upload_id")).rows.map(row => row.upload_id)).toEqual(left);
      expect((await pool.query("SELECT DISTINCT upload_id FROM scan_artifact_chunks ORDER BY upload_id")).rows.map(row => row.upload_id)).toEqual(left);
      await expect(pool.query("INSERT INTO scans (scan_id, repo_id, committed_at, commit_sha, scanner_version) VALUES ('again', 'repo-a', now(), 'abc', '0')"))
        .rejects.toThrow(/scans_repo_commit/);
    });
  });
});
