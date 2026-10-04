ALTER TABLE "dashboards" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_visibility" CHECK ("dashboards"."visibility" IN ('private', 'everyone'));--> statement-breakpoint
UPDATE "dashboards" SET "visibility" = 'everyone';
