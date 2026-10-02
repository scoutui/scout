-- One scan per commit: keep each commit's most recently created scan, and delete the others with their uploads (chunks and jobs cascade).
WITH replaced AS (
  SELECT scan_id, source_upload_id FROM (
    SELECT scan_id, source_upload_id, row_number() OVER (PARTITION BY repo_id, commit_sha ORDER BY created_at DESC, scan_id DESC) AS rank FROM scans
  ) AS ranked WHERE rank > 1
), deleted AS (
  DELETE FROM scans WHERE scan_id IN (SELECT scan_id FROM replaced)
)
DELETE FROM scan_uploads WHERE upload_id IN (SELECT source_upload_id FROM replaced) OR scan_id IN (SELECT scan_id FROM replaced);--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "branch_position" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "scans_repo_commit" ON "scans" USING btree ("repo_id","commit_sha");
