CREATE TABLE "removals" (
	"id" text PRIMARY KEY NOT NULL,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_email" text NOT NULL,
	"repo_id" text NOT NULL,
	"commit_sha" text,
	"scan_count" integer
);
--> statement-breakpoint
CREATE INDEX "removals_removed_at" ON "removals" USING btree ("removed_at" DESC NULLS LAST);