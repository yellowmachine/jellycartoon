ALTER TABLE "waitlist" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "referred_by" text;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_referred_by_user_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;