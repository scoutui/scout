CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "chart_results" (
	"key" text PRIMARY KEY NOT NULL,
	"results_version" integer NOT NULL,
	"format_version" integer NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"payload" json NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cli_device_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_polled_at" timestamp with time zone,
	CONSTRAINT "cli_device_codes_device_code_hash_unique" UNIQUE("device_code_hash"),
	CONSTRAINT "cli_device_codes_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE TABLE "cli_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cli_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance" (
	"id" text PRIMARY KEY NOT NULL,
	"grain" text NOT NULL,
	"target_package" text NOT NULL,
	"target_export" text,
	"disposition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "governance_target" UNIQUE NULLS NOT DISTINCT("target_package","target_export")
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"repo_id" text PRIMARY KEY NOT NULL,
	"git_remote" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_artifact_chunks" (
	"upload_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	CONSTRAINT "scan_artifact_chunks_upload_id_ordinal_pk" PRIMARY KEY("upload_id","ordinal"),
	CONSTRAINT "scan_artifact_chunks_ordinal" CHECK ("scan_artifact_chunks"."ordinal" >= 0),
	CONSTRAINT "scan_artifact_chunks_size" CHECK (octet_length("scan_artifact_chunks"."bytes") BETWEEN 1 AND 1048576)
);
--> statement-breakpoint
CREATE TABLE "scan_component_details" (
	"scan_id" text NOT NULL,
	"selector" text NOT NULL,
	"source_ordinal" integer NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "scan_component_details_scan_id_selector_pk" PRIMARY KEY("scan_id","selector")
);
--> statement-breakpoint
CREATE TABLE "scan_component_facts" (
	"scan_id" text NOT NULL,
	"component_id" text NOT NULL,
	"package_name" text,
	"file_path" text,
	"source_ordinal" integer NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "scan_component_facts_scan_id_component_id_pk" PRIMARY KEY("scan_id","component_id")
);
--> statement-breakpoint
CREATE TABLE "scan_composition_graphs" (
	"scan_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text,
	"source_ordinal" integer NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "scan_composition_graphs_scan_id_kind_source_ordinal_pk" PRIMARY KEY("scan_id","kind","source_ordinal")
);
--> statement-breakpoint
CREATE TABLE "scan_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"upload_id" text,
	"scan_id" text,
	"projection_version" integer NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "scan_jobs_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"repair" boolean DEFAULT false NOT NULL,
	CONSTRAINT "scan_jobs_kind" CHECK ("scan_jobs"."kind" IN ('upload', 'scan', 'results')),
	CONSTRAINT "scan_jobs_target" CHECK (("scan_jobs"."kind" = 'upload') = ("scan_jobs"."upload_id" IS NOT NULL) AND ("scan_jobs"."kind" = 'scan') = ("scan_jobs"."scan_id" IS NOT NULL)),
	CONSTRAINT "scan_jobs_version" CHECK ("scan_jobs"."projection_version" > 0),
	CONSTRAINT "scan_jobs_attempts" CHECK ("scan_jobs"."attempts" >= 0),
	CONSTRAINT "scan_jobs_state" CHECK ("scan_jobs"."state" IN ('queued', 'processing', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "scan_occurrence_views" (
	"scan_id" text NOT NULL,
	"component_id" text NOT NULL,
	"file_path" text NOT NULL,
	"source_ordinal" integer NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "scan_occurrence_views_scan_id_source_ordinal_pk" PRIMARY KEY("scan_id","source_ordinal")
);
--> statement-breakpoint
CREATE TABLE "scan_package_contributions" (
	"scan_id" text NOT NULL,
	"package_name" text NOT NULL,
	"component_id" text NOT NULL,
	"source_ordinal" integer NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "scan_package_contributions_scan_id_package_name_component_id_pk" PRIMARY KEY("scan_id","package_name","component_id")
);
--> statement-breakpoint
CREATE TABLE "scan_read_models" (
	"scan_id" text PRIMARY KEY NOT NULL,
	"projection_version" integer NOT NULL,
	"format_version" integer NOT NULL,
	"state" text NOT NULL,
	"build_revision" integer NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_counts" jsonb NOT NULL,
	"actual_counts" jsonb NOT NULL,
	"details_retained" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_repo_views" (
	"scan_id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"source_ordinal" integer NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_uploads" (
	"upload_id" text PRIMARY KEY NOT NULL,
	"uploaded_by_user_id" text,
	"encoding" text NOT NULL,
	"stored_bytes" bigint DEFAULT 0 NOT NULL,
	"checksum" text,
	"scan_id" text,
	"state" text DEFAULT 'receiving' NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_uploads_encoding" CHECK ("scan_uploads"."encoding" = 'gzip'),
	CONSTRAINT "scan_uploads_stored_bytes" CHECK ("scan_uploads"."stored_bytes" >= 0),
	CONSTRAINT "scan_uploads_state" CHECK ("scan_uploads"."state" IN ('receiving', 'queued', 'processing', 'ready', 'duplicate', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"scan_id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"commit_sha" text NOT NULL,
	"branch" text,
	"cc_version" text NOT NULL,
	"artifact" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_user_id" text,
	"source_upload_id" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"category" text,
	"color" text NOT NULL,
	"rule" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"emailVerified" timestamp,
	"image" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_device_codes" ADD CONSTRAINT "cli_device_codes_approved_user_id_user_id_fk" FOREIGN KEY ("approved_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_sessions" ADD CONSTRAINT "cli_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_artifact_chunks" ADD CONSTRAINT "scan_artifact_chunks_upload_id_scan_uploads_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."scan_uploads"("upload_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_component_details" ADD CONSTRAINT "scan_component_details_scan_id_scans_scan_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("scan_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_component_facts" ADD CONSTRAINT "scan_component_facts_scan_id_scans_scan_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("scan_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_composition_graphs" ADD CONSTRAINT "scan_composition_graphs_scan_id_scans_scan_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("scan_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_upload_id_scan_uploads_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."scan_uploads"("upload_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_scan_id_scans_scan_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("scan_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_occurrence_views" ADD CONSTRAINT "scan_occurrence_views_scan_id_scans_scan_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("scan_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_package_contributions" ADD CONSTRAINT "scan_package_contributions_scan_id_scans_scan_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("scan_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_read_models" ADD CONSTRAINT "scan_read_models_scan_id_scans_scan_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("scan_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_repo_views" ADD CONSTRAINT "scan_repo_views_scan_id_scans_scan_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("scan_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_uploads" ADD CONSTRAINT "scan_uploads_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_uploads" ADD CONSTRAINT "scan_uploads_scan_id_scans_scan_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("scan_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_repo_id_repos_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("repo_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_source_upload_id_scan_uploads_upload_id_fk" FOREIGN KEY ("source_upload_id") REFERENCES "public"."scan_uploads"("upload_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cli_sessions_user_id" ON "cli_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scan_component_facts_package" ON "scan_component_facts" USING btree ("scan_id","package_name","source_ordinal");--> statement-breakpoint
CREATE INDEX "scan_component_facts_ordinal" ON "scan_component_facts" USING btree ("scan_id","source_ordinal");--> statement-breakpoint
CREATE INDEX "scan_composition_graphs_source" ON "scan_composition_graphs" USING btree ("scan_id","kind","source_id");--> statement-breakpoint
CREATE INDEX "scan_composition_graphs_target" ON "scan_composition_graphs" USING btree ("scan_id","kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_jobs_upload_version" ON "scan_jobs" USING btree ("upload_id","projection_version") WHERE "scan_jobs"."upload_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_jobs_scan_version" ON "scan_jobs" USING btree ("scan_id","projection_version") WHERE "scan_jobs"."scan_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "scan_jobs_claim" ON "scan_jobs" USING btree ("priority" DESC NULLS LAST,"available_at","sequence") WHERE "scan_jobs"."state" IN ('queued', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "scan_jobs_results_queued" ON "scan_jobs" USING btree ("kind") WHERE "scan_jobs"."kind" = 'results' AND "scan_jobs"."state" = 'queued';--> statement-breakpoint
CREATE INDEX "scan_occurrence_views_component" ON "scan_occurrence_views" USING btree ("scan_id","component_id","source_ordinal");--> statement-breakpoint
CREATE INDEX "scan_occurrence_views_file" ON "scan_occurrence_views" USING btree ("scan_id","file_path","source_ordinal");--> statement-breakpoint
CREATE INDEX "scan_package_contributions_ordinal" ON "scan_package_contributions" USING btree ("scan_id","package_name","source_ordinal");--> statement-breakpoint
CREATE INDEX "scans_repo_scanned_at_desc" ON "scans" USING btree ("repo_id","scanned_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scans_scanned_at_desc" ON "scans" USING btree ("scanned_at" DESC NULLS LAST);