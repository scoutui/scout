CREATE TABLE "role_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_email" text NOT NULL,
	"subject_email" text NOT NULL,
	"from_role" text NOT NULL,
	"to_role" text
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'viewer';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_signed_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "admin_group" text;--> statement-breakpoint
CREATE INDEX "role_changes_changed_at" ON "role_changes" USING btree ("changed_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role" CHECK ("user"."role" IN ('viewer', 'editor', 'admin'));
--> statement-breakpoint
UPDATE "user" SET "role" = 'editor';