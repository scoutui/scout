ALTER TABLE "scans" RENAME COLUMN "scanned_at" TO "committed_at";--> statement-breakpoint
ALTER INDEX "scans_repo_scanned_at_desc" RENAME TO "scans_repo_committed_at_desc";--> statement-breakpoint
ALTER INDEX "scans_scanned_at_desc" RENAME TO "scans_committed_at_desc";
