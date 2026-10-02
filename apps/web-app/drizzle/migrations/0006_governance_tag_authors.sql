ALTER TABLE "governance" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "governance" ADD COLUMN "updated_by_user_id" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "updated_by_user_id" text;--> statement-breakpoint
ALTER TABLE "governance" ADD CONSTRAINT "governance_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance" ADD CONSTRAINT "governance_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;