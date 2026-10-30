ALTER TABLE "family_settings" ADD COLUMN "rules_cloud_match" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rule" ADD COLUMN "matches" jsonb DEFAULT '{}'::jsonb NOT NULL;