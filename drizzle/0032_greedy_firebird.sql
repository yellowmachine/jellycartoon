ALTER TABLE "kid_settings" ADD COLUMN "video_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "kid_settings" ADD COLUMN "video_off_until" date;