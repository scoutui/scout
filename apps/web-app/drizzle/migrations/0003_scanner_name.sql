ALTER TABLE "scans" RENAME COLUMN "cc_version" TO "scanner_version";--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "scanner" text;
