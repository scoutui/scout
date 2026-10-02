ALTER TABLE "scan_jobs" ADD COLUMN "rescan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_uploads" ADD COLUMN "replaced" boolean DEFAULT false NOT NULL;