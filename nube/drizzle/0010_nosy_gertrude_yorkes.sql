ALTER TABLE "family_member" ADD COLUMN "voice_style" text;--> statement-breakpoint
ALTER TABLE "family_settings" ADD COLUMN "voice_model" text;--> statement-breakpoint
ALTER TABLE "family_settings" ADD COLUMN "voice_style" text;--> statement-breakpoint
ALTER TABLE "family_settings" ADD COLUMN "voice_web" jsonb;--> statement-breakpoint
ALTER TABLE "family_settings" ADD COLUMN "voice_quiet" jsonb;