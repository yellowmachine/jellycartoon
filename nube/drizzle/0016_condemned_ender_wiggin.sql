DROP INDEX "invitation_email_idx";--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "family_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "token" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "invited_by" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "expires_at" timestamp DEFAULT now() + interval '7 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_open_email_idx" ON "invitation" USING btree (lower("email")) WHERE "invitation"."used_at" is null and "invitation"."cancelled_at" is null;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_token_unique" UNIQUE("token");